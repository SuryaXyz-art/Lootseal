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

// The fulfiller's queue: open every requested box strictly in order, re-read
// the chain before each open, and back off on failure. Chain access is
// injected so the loop can be tested without a network.

export interface DropView {
  live: boolean;
  openedCount: bigint;
  requestCount: bigint;
}

export interface Health {
  status: 'starting' | 'running' | 'error';
  network: string;
  drop: string;
  opened: number;
  requested: number;
  pending: number;
  lastOpenedAt: string | null;
  lastError: string | null;
  startedAt: string;
}

export interface QueueDeps {
  /** Reads the drop's current public state. */
  read: () => Promise<DropView>;
  /** Opens box `index` (0-based). Must reject if the chain refuses it. */
  open: (index: bigint) => Promise<void>;
  health: Health;
  log: { info: (msg: string) => void; warn: (obj: object, msg: string) => void };
  /** Schedules a retry; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
  now?: () => Date;
  maxBackoffMs?: number;
}

export const INITIAL_BACKOFF_MS = 2_000;

export function createQueue(deps: QueueDeps): { tick: () => Promise<void>; backoffMs: () => number } {
  const schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  const now = deps.now ?? (() => new Date());
  const maxBackoff = deps.maxBackoffMs ?? 60_000;
  const { health, log } = deps;
  let busy = false;
  let backoff = 0;

  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        const drop = await deps.read();
        health.opened = Number(drop.openedCount);
        health.requested = Number(drop.requestCount);
        health.pending = Number(drop.requestCount - drop.openedCount);
        if (!drop.live || drop.openedCount >= drop.requestCount) break;
        const idx = drop.openedCount;
        log.info(`opening box #${idx + 1n}`);
        await deps.open(idx);
        health.lastOpenedAt = now().toISOString();
        health.lastError = null;
        backoff = 0;
        log.info(`opened box #${idx + 1n}`);
      }
      health.status = 'running';
    } catch (e: unknown) {
      // A state conflict (someone else opened the same box first) or a
      // transient network failure: re-read and retry with backoff.
      health.lastError = e instanceof Error ? e.message : String(e);
      backoff = Math.min(backoff ? backoff * 2 : INITIAL_BACKOFF_MS, maxBackoff);
      log.warn({ err: health.lastError }, `open failed, retrying in ${backoff} ms`);
      schedule(() => void tick(), backoff);
    } finally {
      busy = false;
    }
  };

  return { tick, backoffMs: () => backoff };
}
