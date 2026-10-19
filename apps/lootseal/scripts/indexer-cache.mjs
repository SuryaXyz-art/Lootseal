// This file is part of Lootseal.
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// A local cache in front of a remote Midnight indexer, for fast wallet syncs.
//
// A fresh wallet replays every zswap and dust ledger event from genesis. The
// public indexers stream those to one subscription at only a handful of events
// per second, so on a long-lived network (Preview: ~270k dust events) a first
// sync takes the better part of a day. Parallel subscriptions starting at
// different ids are not throttled together, so:
//
//   node scripts/indexer-cache.mjs fetch preview   # pull both streams in parallel
//   node scripts/indexer-cache.mjs serve preview   # ws://127.0.0.1:8090/api/v4/graphql/ws
//
// `serve` answers zswapLedgerEvents / dustLedgerEvents subscriptions from the
// cache, then hands the same subscription over to the real indexer for anything
// newer; every other message is proxied untouched. Point a wallet at it with
// MIDNIGHT_INDEXER_WS=ws://127.0.0.1:8090/api/v4/graphql/ws. The cache holds
// public chain data only.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createClient } from 'graphql-ws';
import WebSocket, { WebSocketServer } from 'ws';

const UPSTREAM = {
  preview: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  preprod: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
};
const STREAMS = {
  dustLedgerEvents: 'type: __typename id raw maxId',
  zswapLedgerEvents: 'id raw protocolVersion maxId',
};
const WORKERS = Number(process.env['CACHE_WORKERS'] ?? 16);
const PORT = Number(process.env['CACHE_PORT'] ?? 8090);
const IDLE_MS = 45_000;

const [mode, network = 'preview'] = process.argv.slice(2);
const upstream = process.env['UPSTREAM_INDEXER_WS'] ?? UPSTREAM[network];
const dir = path.resolve(new URL(import.meta.url).pathname, '../../.indexer-cache', network);
const fileOf = (stream) => path.join(dir, `${stream}.ndjson`);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (!upstream || !['fetch', 'serve'].includes(mode)) {
  console.error('usage: indexer-cache.mjs fetch|serve <preview|preprod>');
  process.exit(2);
}

// ─── fetch ──────────────────────────────────────────────────────────────────

/**
 * Collect events of `stream` with from <= id < to into `events` over one
 * subscription. On failure `events` keeps what arrived, so a retry resumes.
 */
function fetchRange(stream, from, to, events, onProgress) {
  return new Promise((resolve, reject) => {
    const client = createClient({ url: upstream, webSocketImpl: WebSocket, retryAttempts: 0, lazy: true });
    let idle;
    let done = false;
    let dispose = () => {};
    const end = (err) => {
      if (done) return;
      done = true;
      clearTimeout(idle);
      try {
        dispose();
        void Promise.resolve(client.dispose()).catch(() => {});
      } catch {
        // already closed
      }
      if (err) reject(err);
      else resolve();
    };
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => end(), IDLE_MS);
    };
    touch();
    const start = events.length ? events.at(-1).id + 1 : from;
    dispose = client.subscribe(
      { query: `subscription($id: Int) { ${stream}(id: $id) { ${STREAMS[stream]} } }`, variables: { id: start === 0 ? null : start } },
      {
        next: ({ data, errors }) => {
          if (errors) return end(new Error(JSON.stringify(errors).slice(0, 200)));
          const e = data[stream];
          if (e.id >= to) return end();
          if (e.id >= start) {
            events.push(e);
            onProgress(1);
          }
          touch();
        },
        error: (err) => end(err instanceof Error ? err : new Error(String(err?.reason ?? err?.code ?? JSON.stringify(err)).slice(0, 200))),
        complete: () => end(),
      },
    );
  });
}

async function tipOf(stream) {
  const events = await new Promise((resolve, reject) => {
    const client = createClient({ url: upstream, webSocketImpl: WebSocket });
    const dispose = client.subscribe(
      { query: `subscription { ${stream} { id maxId } }` },
      {
        next: ({ data }) => {
          dispose();
          client.dispose();
          resolve(data[stream]);
        },
        error: reject,
        complete: () => {},
      },
    );
  });
  return Number(events.maxId);
}

async function fetchStream(stream) {
  const maxId = await tipOf(stream);
  const end = maxId + 1;
  let got = 0;
  const started = Date.now();
  const timer = setInterval(() => {
    const s = (Date.now() - started) / 1000;
    log(`${stream}: ${got.toLocaleString()} events, ${(got / s).toFixed(0)}/s`);
  }, 15_000);
  const partsDir = path.join(dir, 'parts');
  mkdirSync(partsDir, { recursive: true });
  // Finished ranges from earlier runs are reused; only the gaps between them
  // are fetched, split across all workers so a slow tail still runs wide.
  const saved = readdirSync(partsDir)
    .map((f) => f.match(new RegExp(`^${stream}-(\\d+)-(\\d+)\\.json$`)))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2])])
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cursor = 0;
  for (const [from, to] of saved) {
    if (from > cursor) gaps.push([cursor, Math.min(from, end)]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < end) gaps.push([cursor, end]);
  const gapTotal = gaps.reduce((n, [a, b]) => n + (b - a), 0) || 1;
  const ranges = gaps.flatMap(([a, b]) => {
    const pieces = Math.max(1, Math.round((WORKERS * (b - a)) / gapTotal));
    const step = Math.ceil((b - a) / pieces);
    return Array.from({ length: pieces }, (_, i) => [a + i * step, Math.min(a + (i + 1) * step, b)]).filter(([x, y]) => y > x);
  });
  log(`${stream}: ${saved.length} saved ranges, fetching ${ranges.length} more up to id ${maxId}`);
  const reused = saved.map(([from, to]) => {
    const events = JSON.parse(readFileSync(path.join(partsDir, `${stream}-${from}-${to}.json`), 'utf8'));
    got += events.length;
    return events;
  });
  const fetched = await Promise.all(
    ranges.map(async ([from, to]) => {
      const partFile = path.join(partsDir, `${stream}-${from}-${to}.json`);
      const events = [];
      for (let attempt = 1; ; attempt++) {
        try {
          await fetchRange(stream, from, to, events, (n) => (got += n));
          writeFileSync(partFile, JSON.stringify(events));
          return events;
        } catch (err) {
          if (attempt >= 50) throw err;
          log(`${stream} [${from}, ${to}) dropped at ${events.length} events (${err.message}); resuming`);
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }
    }),
  );
  clearInterval(timer);
  const all = [...reused, ...fetched].flat().sort((a, b) => a.id - b.id);
  const tmp = `${fileOf(stream)}.tmp`;
  const out = createWriteStream(tmp);
  let last = -1;
  let kept = 0;
  for (const e of all) {
    if (e.id === last) continue;
    last = e.id;
    kept++;
    out.write(`${JSON.stringify(e)}\n`);
  }
  await new Promise((r) => out.end(r));
  renameSync(tmp, fileOf(stream));
  log(`${stream}: cached ${kept.toLocaleString()} events up to id ${last} (tip was ${maxId}) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

// ─── serve ──────────────────────────────────────────────────────────────────

async function load(stream) {
  const events = [];
  if (!existsSync(fileOf(stream))) return events;
  const rl = createInterface({ input: createReadStream(fileOf(stream)) });
  for await (const line of rl) if (line) events.push(JSON.parse(line));
  return events;
}

/** First index in `events` with id >= target. */
function lowerBound(events, target) {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].id < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function serve() {
  const cache = {};
  for (const s of Object.keys(STREAMS)) {
    cache[s] = await load(s);
    log(`${s}: ${cache[s].length.toLocaleString()} cached events (last id ${cache[s].at(-1)?.id ?? '-'})`);
  }
  const wss = new WebSocketServer({ port: PORT, path: '/api/v4/graphql/ws', handleProtocols: (p) => (p.has('graphql-transport-ws') ? 'graphql-transport-ws' : false) });
  log(`serving ws://127.0.0.1:${PORT}/api/v4/graphql/ws → ${upstream}`);

  wss.on('connection', (client) => {
    const up = new WebSocket(upstream, 'graphql-transport-ws');
    const pending = [];
    const toUp = (msg) => (up.readyState === WebSocket.OPEN ? up.send(msg) : pending.push(msg));
    up.on('open', () => pending.splice(0).forEach((m) => up.send(m)));
    up.on('message', (m) => client.readyState === WebSocket.OPEN && client.send(m.toString()));
    up.on('close', () => client.close());
    up.on('error', () => client.close());
    client.on('close', () => up.close());

    // Locally served subscriptions: op id → { stop }.
    const local = new Map();

    const serveLocal = (opId, stream, payload, fromId) => {
      const events = cache[stream];
      let i = lowerBound(events, fromId);
      const op = { stopped: false };
      local.set(opId, op);
      const pump = () => {
        if (op.stopped || client.readyState !== WebSocket.OPEN) return;
        // Respect the socket's buffer so a slow consumer's backpressure works.
        while (i < events.length && client.bufferedAmount < 4 * 1024 * 1024) {
          client.send(JSON.stringify({ id: opId, type: 'next', payload: { data: { [stream]: events[i] } } }));
          i++;
        }
        if (i < events.length) return void setTimeout(pump, 5);
        // Cache exhausted: continue the same op live from the real indexer.
        local.delete(opId);
        const nextId = (events.at(-1)?.id ?? -1) + 1;
        const variables = { ...(payload.variables ?? {}), id: Math.max(nextId, fromId) };
        toUp(JSON.stringify({ id: opId, type: 'subscribe', payload: { ...payload, variables } }));
      };
      pump();
    };

    client.on('message', (raw) => {
      const text = raw.toString();
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return toUp(text);
      }
      if (msg.type === 'subscribe') {
        const stream = Object.keys(STREAMS).find((s) => msg.payload?.query?.includes(`${s}(`));
        if (stream && cache[stream].length > 0) {
          const id = msg.payload.variables?.id;
          return serveLocal(msg.id, stream, msg.payload, id === null || id === undefined ? 0 : Number(id));
        }
      }
      if (msg.type === 'complete' && local.has(msg.id)) {
        local.get(msg.id).stopped = true;
        local.delete(msg.id);
        return;
      }
      toUp(text);
    });
  });
}

// graphql-ws can reject internally when a socket drops; the retry loops above recover.
process.on('unhandledRejection', (reason) => log('ignored rejection:', reason?.message ?? reason?.reason ?? String(reason)));

if (mode === 'fetch') {
  mkdirSync(dir, { recursive: true });
  const only = process.env['CACHE_STREAM'];
  await Promise.all(Object.keys(STREAMS).filter((s) => !only || s === only).map(fetchStream));
  process.exit(0);
} else {
  await serve();
}
