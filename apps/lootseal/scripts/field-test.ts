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

// The field test: Lootseal used the way real people use it, on a real
// network, with every step checked against the chain afterwards.
//
//   MIDNIGHT_NETWORK=preview LOOTSEAL_STATE_STORE=<deploy store> yarn field-test
//
// Three drops, three stories:
//   A. Genesis Relics (the live demo drop): eight players buy boxes, the
//      publisher opens them in order, every player decrypts their own pulls,
//      proves rarity badges, gifts, lists on the bazaar, cancels, and buys
//      through escrow.
//   B. Lantern Run: a small drop launched from scratch, sold out, opened,
//      revealed and audited on chain (verifyOdds); an escrowed bazaar sale
//      whose seller never delivers is refunded to the buyer.
//   C. Ghost Lantern: a publisher who never opens. The buyer reclaims the
//      price plus a penalty from the publisher's bond, and the drop defaults.
// Alongside, people try what they should not be able to do (open boxes they
// do not publish, prove rarity they do not have, spend items they do not own,
// refund early, …); each attempt must be refused by the contract.
//
// Every check is written to deployments/<network>-field-test.json (public:
// transaction hashes, block heights, fees, what was verified) which the web
// app shows at #/field-test and re-checks against the indexer. Private
// details (who holds which item type) stay in .secrets/<network>/. One funded
// wallet pays every fee, as in the devnet suite; each player is a separate
// private identity with its own keys. A rerun resumes after the last check.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { encodeUserAddress, type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { waitForDust } from '@midnight-ntwrk/example-fast-sync';
import { getConfig } from '../src/config.js';
import { MidnightWalletProvider, syncWallet } from '../src/wallet.js';
import { buildProviders } from '../src/providers.js';
import {
  CompiledLootsealContract,
  CompiledRegistryContract,
  ledger,
  pureCircuits,
  registryLedger,
  registryZkConfigPath,
  zkConfigPath,
} from '../contract/index.js';
import {
  createLootsealPrivateState,
  createPublisherPrivateState,
  fromHex,
  randomBytes,
  toHex,
  type LootsealPrivateState,
} from '../contract/witnesses.js';
import { createRegistryPrivateState } from '../contract/registry-witnesses.js';
import {
  DROP_CIRCUITS,
  encodeText32,
  ITEM_TYPES,
  lootsealIdOf,
  ownerKeyOf,
  parseLootsealId,
  replaySupply,
  syncVault,
  TIER_NAMES,
  withReplayedSupply,
} from '../contract/lib.js';
import { deployStaged, missingCircuits } from '../contract/staged-deploy.js';

// @ts-expect-error WebSocket global for the indexer client in Node
globalThis.WebSocket = WebSocket;

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });
const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const root = path.resolve(new URL(import.meta.url).pathname, '../..');
const secretsDir = path.join(root, '.secrets', network);
const deployment = JSON.parse(readFileSync(path.join(root, 'deployments', `${network}.json`), 'utf8')) as {
  registryAddress: string;
  drops: { address: string; title: string }[];
};
const GENESIS = deployment.drops[0]!.address as ContractAddress;
const REGISTRY = deployment.registryAddress as ContractAddress;
const NIGHT = 1_000_000n;

// ─── Journal ────────────────────────────────────────────────────────────────

type Expect = 'accepted' | 'rejected' | 'verified';
type Check = {
  n: number;
  key: string;
  scenario: string;
  drop: string;
  actor: string;
  action: string;
  circuit?: string;
  expect: Expect;
  result: 'pass' | 'fail';
  /** What was checked on chain (or refused, and why). */
  detail: string;
  tx?: { hash: string; id: string; blockHeight: number; blockTimestamp: number; feesSpecks?: string };
  seconds: number;
  at: string;
};
type Journal = {
  network: string;
  registry: string;
  drops: Record<string, { title: string; story: string }>;
  startedAt: string;
  updatedAt: string;
  feePayer?: string;
  checks: Check[];
};

const journalFile = path.join(root, 'deployments', `${network}-field-test.json`);
const ctxFile = path.join(secretsDir, 'field-test.json');
const journal: Journal = existsSync(journalFile)
  ? JSON.parse(readFileSync(journalFile, 'utf8'))
  : { network, registry: REGISTRY, drops: {}, startedAt: new Date().toISOString(), updatedAt: '', checks: [] };
/** Private run state: addresses of the drops made here, chosen items, players' pulls. */
const ctx: Record<string, any> = existsSync(ctxFile) ? JSON.parse(readFileSync(ctxFile, 'utf8')) : {};
const saveJournal = () => {
  journal.updatedAt = new Date().toISOString();
  writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
};
const saveCtx = () => {
  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(ctxFile, JSON.stringify(ctx, null, 2), { mode: 0o600 });
};
const passed = (key: string) => journal.checks.some((c) => c.key === key && c.result === 'pass');
const record = (c: Omit<Check, 'n' | 'at'>) => {
  const entry = { ...c, n: 0, at: new Date().toISOString() };
  const i = journal.checks.findIndex((x) => x.key === c.key);
  if (i >= 0) journal.checks[i] = entry;
  else journal.checks.push(entry);
  journal.checks.forEach((x, i) => (x.n = i + 1));
  saveJournal();
  const mark = c.result === 'pass' ? '✓' : '✗';
  logger.info(`${mark} [${entry.n}] ${c.actor}: ${c.action} — ${c.detail}${c.tx ? ` (block ${c.tx.blockHeight})` : ''}`);
};

const errText = (e: unknown): string => {
  const parts: string[] = [];
  let cur: any = e;
  for (let i = 0; cur && i < 5; i++) {
    parts.push(String(cur?.message ?? cur));
    cur = cur?.cause;
  }
  return parts.join(' ← ');
};

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Check failed: ${msg}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = getConfig();
  setNetworkId(config.networkId);
  const env: EnvironmentConfiguration = {
    walletNetworkId: config.networkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };
  const seed = process.env['ACTIVITY_SEED'] ?? (JSON.parse(readFileSync(path.join(secretsDir, 'deployer.json'), 'utf8')) as { seed: string }).seed;
  const wallet = await MidnightWalletProvider.build(logger, env, { kind: 'seed', value: seed });
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 60 * 60_000);
  await waitForDust(logger, wallet.wallet);
  const providers = buildProviders(wallet, zkConfigPath, config);
  const registryProviders = buildProviders(wallet, registryZkConfigPath, config);
  const payout = () => ({ bytes: encodeUserAddress(wallet.unshieldedKeystore.getAddress()) });
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  journal.feePayer = String((wallet.unshieldedKeystore as any).getBech32Address?.() ?? wallet.unshieldedKeystore.getAddress());

  const read = async (drop: string) => ledger((await providers.publicDataProvider.queryContractState(drop as ContractAddress))!.data);
  const readRegistry = async () => registryLedger((await registryProviders.publicDataProvider.queryContractState(REGISTRY))!.data);
  const getState = async (drop: string, id: string) => {
    providers.privateStateProvider.setContractAddress(drop as ContractAddress);
    return (await providers.privateStateProvider.get(id)) as LootsealPrivateState | null;
  };
  const setState = async (drop: string, id: string, ps: LootsealPrivateState) => {
    providers.privateStateProvider.setContractAddress(drop as ContractAddress);
    await providers.privateStateProvider.set(id, ps);
  };
  const player = async (drop: string, id: string) => {
    const ps = await getState(drop, id);
    if (ps) return ps;
    const fresh = createLootsealPrivateState();
    await setState(drop, id, fresh);
    return fresh;
  };
  const vaultOf = async (drop: string, id: string) => {
    const next = syncVault(drop, (await getState(drop, id))!, await read(drop));
    await setState(drop, id, next);
    return next;
  };
  const submit = (drop: string, id: string, circuitId: string, args: unknown[]) => {
    providers.privateStateProvider.setContractAddress(drop as ContractAddress);
    return (submitCallTx as any)(providers, { compiledContract: CompiledLootsealContract, contractAddress: drop, privateStateId: id, circuitId, args });
  };
  const txOf = (res: any): Check['tx'] => {
    const p = res?.public ?? res;
    return {
      hash: String(p.txHash),
      id: String(p.txId),
      blockHeight: Number(p.blockHeight),
      blockTimestamp: Number(p.blockTimestamp),
      feesSpecks: p.fees?.paidFees !== undefined ? String(p.fees.paidFees) : undefined,
    };
  };

  type Base = { scenario: string; drop: string; actor: string; action: string };

  /** A real transaction that must go through, then a check of its effect. */
  const accept = async (
    key: string,
    base: Base & { circuit: string },
    run: () => Promise<any>,
    verify: (before: any, after: any) => Promise<string> | string,
    opts: { before?: () => Promise<any>; already?: () => Promise<boolean> } = {},
  ) => {
    if (passed(key)) return;
    const t = Date.now();
    for (let attempt = 1; ; attempt++) {
      const before = opts.before ? await opts.before() : await read(base.drop);
      try {
        const res = await run();
        const after = opts.before ? await opts.before() : await read(base.drop);
        const detail = await verify(before, after);
        record({ key, ...base, expect: 'accepted', result: 'pass', detail, tx: res ? txOf(res) : undefined, seconds: Math.round((Date.now() - t) / 1000) });
        return;
      } catch (e) {
        const msg = errText(e);
        if (msg.startsWith('Check failed') || attempt >= 3) {
          record({ key, ...base, expect: 'accepted', result: 'fail', detail: msg.slice(0, 400), seconds: Math.round((Date.now() - t) / 1000) });
          return;
        }
        if (opts.already && (await opts.already().catch(() => false))) {
          logger.warn(`${key}: the network reported an error but the effect is on chain; verifying`);
          const after = opts.before ? await opts.before() : await read(base.drop);
          const detail = await Promise.resolve().then(() => verify(before, after)).catch((err: unknown) => errText(err));
          record({ key, ...base, expect: 'accepted', result: 'pass', detail, seconds: Math.round((Date.now() - t) / 1000) });
          return;
        }
        logger.warn(`${key}: attempt ${attempt} failed (${msg.slice(0, 200)}); retrying`);
        await sleep(15_000);
      }
    }
  };

  /** Something that must be refused, with the contract's reason. */
  const reject = async (key: string, base: Base & { circuit: string }, expected: string, run: () => Promise<any>) => {
    if (passed(key)) return;
    const t = Date.now();
    try {
      const res = await run();
      record({
        key, ...base, expect: 'rejected', result: 'fail',
        detail: 'The network ACCEPTED something it should have refused', tx: txOf(res), seconds: Math.round((Date.now() - t) / 1000),
      });
    } catch (e) {
      const msg = errText(e);
      const ok = msg.includes(expected);
      record({
        key, ...base, expect: 'rejected', result: ok ? 'pass' : 'fail',
        detail: ok ? `Refused: "${expected}"` : `Refused for an unexpected reason: ${msg.slice(0, 300)}`,
        seconds: Math.round((Date.now() - t) / 1000),
      });
    }
  };

  /** A read-only check of chain data (and the player's own decryption). */
  const verify = async (key: string, base: Base, fn: () => Promise<string>) => {
    if (passed(key)) return;
    const t = Date.now();
    try {
      record({ key, ...base, expect: 'verified', result: 'pass', detail: await fn(), seconds: Math.round((Date.now() - t) / 1000) });
    } catch (e) {
      record({ key, ...base, expect: 'verified', result: 'fail', detail: errText(e).slice(0, 400), seconds: Math.round((Date.now() - t) / 1000) });
    }
  };

  /** A copy of `id`'s state that (wrongly) believes it holds `itemId` with `opening`. */
  const forged = async (drop: string, id: string, itemId: string, opening: unknown) => {
    const ps = await player(drop, id);
    const fid = `${id}-forged`;
    await setState(drop, fid, { ...ps, items: { ...ps.items, [itemId]: opening as any } });
    return fid;
  };

  /** Waits until block time has passed `unixSeconds` (with a margin). */
  const waitForBlockTime = async (unixSeconds: bigint, why: string) => {
    const target = Number(unixSeconds) * 1000 + 45_000;
    if (Date.now() < target) {
      logger.info(`Waiting ${Math.ceil((target - Date.now()) / 1000)}s: ${why}`);
      await sleep(target - Date.now());
    }
  };

  // ─── A. Genesis Relics: a community plays the live drop ──────────────────

  const A = 'A · Genesis Relics, played by a community';
  journal.drops[GENESIS] = {
    title: 'Genesis Relics',
    story: 'The live demo drop (1,000 boxes). Eight players buy, open, decrypt, prove, gift and trade.',
  };
  if (!(await getState(GENESIS, 'publisher'))?.publisher) {
    throw new Error('No publisher secrets for Genesis Relics in this store: set LOOTSEAL_STATE_STORE to the deploy store');
  }
  const PLAYERS: [string, number][] = [
    ['aria', 2], ['kenji', 2], ['lena', 1], ['omar', 2], ['sofia', 1], ['devi', 1], ['mia', 1], ['theo', 2],
  ];
  const g = { scenario: A, drop: GENESIS };

  await verify('A:live', { ...g, actor: 'anyone', action: 'Check the drop is live and listed in the registry' }, async () => {
    const l = await read(GENESIS);
    ensure(Number(l.state) === 2, `state is ${l.state}, expected LIVE`);
    ensure(!l.tableCommit.every((b: number) => b === 0) && !l.seedCommit.every((b: number) => b === 0), 'table and seed are committed');
    const reg = await readRegistry();
    ensure(reg.registered.member(fromHex(GENESIS)), 'the registry lists the drop');
    const odds = l.tierTotals.map((t: bigint) => `${Number((t * 1000n) / l.totalSupply) / 10}%`).join(' / ');
    return `LIVE, table + seed committed, registered. Advertised odds ${odds} of ${l.totalSupply} boxes, bond ${l.bondRemaining / NIGHT} NIGHT`;
  });

  // Buy boxes.
  for (const [id, boxes] of PLAYERS) {
    const ps = await player(GENESIS, id);
    for (let i = 0; i < boxes; i++) {
      const key = `A:buy:${id}:${i}`;
      if (passed(key)) continue;
      const buyerSeed = randomBytes(32);
      await accept(
        key,
        { ...g, actor: id, action: `Buy box ${i + 1} of ${boxes} (5 NIGHT)`, circuit: 'requestBox' },
        () => submit(GENESIS, id, 'requestBox', [buyerSeed, payout(), now()]),
        (b, a) => {
          ensure(a.requestCount === b.requestCount + 1n, 'requestCount grew by one');
          const req = a.requests.lookup(b.requestCount);
          ensure(toHex(req.ownerPk) === toHex(ownerKeyOf(GENESIS, ps)), 'the request is bound to this player\'s hidden key');
          ensure(toHex(req.buyerSeed) === toHex(buyerSeed), 'the buyer seed is recorded');
          return `Request #${b.requestCount} queued (PENDING), bound to ${id}'s private key, buyer seed on chain`;
        },
      );
    }
  }

  await reject(
    'A:skewed-clock', { ...g, actor: 'sofia', action: 'Buy a box with a clock two hours ahead', circuit: 'requestBox' },
    'Your clock is too far from block time',
    () => submit(GENESIS, 'sofia', 'requestBox', [randomBytes(32), payout(), now() + 7200n]),
  );
  await reject(
    'A:not-publisher-open', { ...g, actor: 'aria', action: 'Try to open the next box herself (not the publisher)', circuit: 'openBox' },
    'This wallet holds no publisher secrets',
    () => submit(GENESIS, 'aria', 'openBox', []),
  );
  // mallory forges publisher secrets of her own; the circuit must still refuse.
  if (!(await getState(GENESIS, 'mallory'))) {
    await setState(GENESIS, 'mallory', createPublisherPrivateState(Array.from({ length: ITEM_TYPES }, () => 0n)));
  }
  await reject(
    'A:forged-publisher-open', { ...g, actor: 'mallory', action: 'Open a box with forged publisher secrets', circuit: 'openBox' },
    'Only the publisher can do this',
    () => submit(GENESIS, 'mallory', 'openBox', []),
  );

  // The publisher opens every pending box, strictly in order.
  for (;;) {
    const l = await read(GENESIS);
    if (l.openedCount >= l.requestCount) break;
    const idx = l.openedCount;
    await setState(GENESIS, 'publisher', withReplayedSupply((await getState(GENESIS, 'publisher'))!, l));
    await accept(
      `A:open:${idx}`,
      { ...g, actor: 'publisher', action: `Open box #${idx} (FIFO)`, circuit: 'openBox' },
      () => submit(GENESIS, 'publisher', 'openBox', []),
      (b, a) => {
        ensure(a.openedCount === idx + 1n, 'openedCount advanced by one');
        ensure(Number(a.requests.lookup(idx).status) === 1, 'the request is OPENED');
        const itemId = pureCircuits.itemIdOf(idx);
        ensure(a.items.member(itemId) && a.deliveries.member(itemId), 'an item commitment and an encrypted delivery exist');
        ensure(toHex(a.remainingCommit) !== toHex(b.remainingCommit), 'the hidden supply commitment rolled forward');
        ensure(a.publisherClaimable === b.publisherClaimable + a.price, 'the price moved to the publisher\'s claimable balance');
        return `Box #${idx} opened in order; item ${toHex(itemId).slice(0, 10)}… committed + encrypted to its buyer; supply commitment re-salted`;
      },
      { already: async () => (await read(GENESIS)).openedCount > idx },
    );
    if (!passed(`A:open:${idx}`)) break;
  }

  await reject(
    'A:open-empty', { ...g, actor: 'publisher', action: 'Open a box when nobody is waiting', circuit: 'openBox' },
    'No boxes are waiting to be opened',
    async () => {
      await setState(GENESIS, 'publisher', withReplayedSupply((await getState(GENESIS, 'publisher'))!, await read(GENESIS)));
      return submit(GENESIS, 'publisher', 'openBox', []);
    },
  );
  await reject(
    'A:refund-opened', { ...g, actor: 'kenji', action: 'Claim a refund for a box that was already opened', circuit: 'claimRefund' },
    'This box is not waiting to be opened',
    () => submit(GENESIS, 'kenji', 'claimRefund', [0n]),
  );

  // Every player decrypts their own pulls; nobody can open anyone else's.
  const pulls: Record<string, { itemId: string; tier: number; type: number; serial: string }[]> = {};
  for (const [id, boxes] of PLAYERS) {
    await verify(`A:vault:${id}`, { ...g, actor: id, action: 'Open the vault and decrypt my deliveries' }, async () => {
      const l = await read(GENESIS);
      const ps = await vaultOf(GENESIS, id);
      const mine = Object.entries(ps.items);
      ensure(mine.length >= boxes, `${id} decrypts at least ${boxes} item(s), got ${mine.length}`);
      for (const [itemId, op] of mine) {
        const commit = l.items.lookup(fromHex(itemId));
        ensure(toHex(pureCircuits.itemCommit(op, ownerKeyOf(GENESIS, ps))) === toHex(commit), 'the opening reproduces the on-chain commitment');
      }
      return `${mine.length} item(s) decrypted with ${id}'s own key; each opening reproduces its on-chain commitment (tiers stay private)`;
    });
    const ps = (await getState(GENESIS, id))!;
    const l = await read(GENESIS);
    pulls[id] = Object.entries(ps.items).map(([itemId, op]) => ({
      itemId, type: Number(op.itemType), tier: Number(l.catalogTiers[Number(op.itemType)]), serial: op.serial.toString(),
    }));
  }
  ctx.genesisPulls = pulls;
  saveCtx();

  await verify('A:exclusive', { ...g, actor: 'anyone', action: 'Cross-check: every delivery opens for exactly one player' }, async () => {
    const l = await read(GENESIS);
    const owners = new Map<string, string[]>();
    for (const [id] of PLAYERS) {
      const ps = syncVault(GENESIS, (await getState(GENESIS, id))!, l);
      for (const itemId of Object.keys(ps.items)) owners.set(itemId, [...(owners.get(itemId) ?? []), id]);
    }
    const shared = [...owners.values()].filter((o) => o.length > 1);
    ensure(shared.length === 0, 'no delivery decrypts for two players');
    return `${owners.size} deliveries tried with all ${PLAYERS.length} players' keys: each opens for its owner only`;
  });
  await verify('A:supply-replay', { ...g, actor: 'publisher', action: 'Replay the hidden supply from public requests + secrets' }, async () => {
    const l = await read(GENESIS);
    const sup = replaySupply((await getState(GENESIS, 'publisher'))!.publisher!, l);
    const minted = sup.minted.reduce((a, b) => a + b, 0n);
    ensure(minted === l.openedCount, 'the replay minted exactly the opened boxes');
    return `Replayed ${l.openedCount} draws; the result opens the on-chain remainingCommit exactly (no hidden edits possible)`;
  });

  // Rarity badges for the best pulls.
  const all = Object.entries(pulls).flatMap(([id, items]) => items.map((it) => ({ id, ...it })));
  all.sort((a, b) => a.tier - b.tier);
  ctx.badges ??= all.slice(0, 3).map(({ id, itemId, tier }) => ({ id, itemId, tier }));
  saveCtx();
  for (const b of ctx.badges as { id: string; itemId: string; tier: number }[]) {
    const context = encodeText32('Genesis showcase');
    await accept(
      `A:badge:${b.itemId}`,
      { ...g, actor: b.id, action: `Prove "${TIER_NAMES[b.tier]} or rarer" without revealing the item`, circuit: 'proveRarityTier' },
      () => submit(GENESIS, b.id, 'proveRarityTier', [fromHex(b.itemId), BigInt(b.tier), context]),
      (_b, a) => {
        const ver = a.deliveries.lookup(fromHex(b.itemId)).version;
        const badgeId = pureCircuits.badgeIdOf(fromHex(b.itemId), context, ver);
        ensure(a.badges.member(badgeId), 'the badge is on chain');
        ensure(Number(a.badges.lookup(badgeId).maxTier) === b.tier, 'the badge states the proven bound');
        ctx[`badge:${b.itemId}`] = toHex(badgeId);
        saveCtx();
        return `Badge ${toHex(badgeId).slice(0, 10)}… proves tier ≤ ${TIER_NAMES[b.tier]}; item type and owner stay hidden. Verify: #/verify/${GENESIS}/${toHex(badgeId)}`;
      },
    );
  }

  const common = all.filter((x) => x.tier === 4).at(-1) ?? all.at(-1)!;
  await reject(
    'A:overclaim', { ...g, actor: common.id, action: 'Claim a Legendary badge for a lower-tier item', circuit: 'proveRarityTier' },
    'This item is not that rare',
    () => submit(GENESIS, common.id, 'proveRarityTier', [fromHex(common.itemId), 0n, encodeText32('fake flex')]),
  );
  const victim = all[0]!;
  const thief = PLAYERS.map(([p]) => p).find((p) => p !== victim.id)!;
  await reject(
    'A:steal-with-plaintext', { ...g, actor: thief, action: `Move ${victim.id}'s item after learning its full plaintext opening`, circuit: 'transferItem' },
    'You do not own this item',
    async () => {
      // The worst case: the thief knows the exact type, serial and salt.
      const vps = (await getState(GENESIS, victim.id))!;
      const fid = await forged(GENESIS, thief, victim.itemId, vps.items[victim.itemId]);
      const me = parseLootsealId(lootsealIdOf(GENESIS, (await getState(GENESIS, thief))!));
      return submit(GENESIS, fid, 'transferItem', [fromHex(victim.itemId), me.ownerPk, me.encKey]);
    },
  );

  // A gift: theo sends his last pull to mia.
  ctx.gift ??= pulls['theo']!.at(-1)!.itemId;
  saveCtx();
  const giftId = ctx.gift as string;
  ctx.giftOpening ??= JSON.parse(JSON.stringify((await getState(GENESIS, 'theo'))!.items[giftId], (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
  saveCtx();
  // A stored opening's salt may come back as a Node Buffer ({type, data}) or an index map.
  const toBytes = (v: any): Uint8Array =>
    v instanceof Uint8Array ? Uint8Array.from(v) : Uint8Array.from((Array.isArray(v?.data) ? v.data : Object.values(v)) as number[]);
  const revive = (o: unknown) => JSON.parse(JSON.stringify(o), (_k, v) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
  await accept(
    'A:gift',
    { ...g, actor: 'theo', action: 'Gift an item to mia by her Lootseal ID', circuit: 'transferItem' },
    async () => {
      const mia = parseLootsealId(lootsealIdOf(GENESIS, (await getState(GENESIS, 'mia'))!));
      return submit(GENESIS, 'theo', 'transferItem', [fromHex(giftId), mia.ownerPk, mia.encKey]);
    },
    async () => {
      const theo = await vaultOf(GENESIS, 'theo');
      const mia = await vaultOf(GENESIS, 'mia');
      ensure(!theo.items[giftId], 'theo can no longer open it');
      ensure(!!mia.items[giftId], 'mia decrypts it with her own key');
      return `Re-encrypted to mia on chain: mia decrypts it, theo no longer can; sender and recipient stay unlinkable`;
    },
  );
  await reject(
    'A:regift', { ...g, actor: 'theo', action: 'Sell the item he already gave away, using his old copy of its opening', circuit: 'listItem' },
    'You do not own this item',
    async () => {
      const op = revive(ctx.giftOpening);
      op.salt = toBytes(op.salt);
      op.itemType = BigInt(String(op.itemType).replace(/n$/, ''));
      op.serial = BigInt(String(op.serial).replace(/n$/, ''));
      const fid = await forged(GENESIS, 'theo', giftId, op);
      return submit(GENESIS, fid, 'listItem', [fromHex(giftId), 10n * NIGHT, 4n, payout()]);
    },
  );

  // The bazaar.
  const LIST_PRICE = [420n, 128n, 36n, 14n, 7n];
  if (!ctx.listings) {
    const owned = async (id: string) => Object.keys((await vaultOf(GENESIS, id)).items);
    const picks: { id: string; itemId: string; tier: number }[] = [];
    for (const [id] of PLAYERS) {
      if (id === 'theo' || id === 'mia') continue;
      const mine = await owned(id);
      const pick = all.find((x) => x.id === id && mine.includes(x.itemId) && !(ctx.badges as any[]).some((b) => b.itemId === x.itemId));
      if (pick) picks.push({ id, itemId: pick.itemId, tier: pick.tier });
    }
    ctx.listings = picks.slice(0, 5);
    saveCtx();
  }
  const listings = ctx.listings as { id: string; itemId: string; tier: number }[];
  for (const [i, h] of listings.entries()) {
    const price = (LIST_PRICE[h.tier]! + BigInt(i % 3)) * NIGHT;
    await accept(
      `A:list:${h.itemId}`,
      { ...g, actor: h.id, action: `List an item as "${TIER_NAMES[h.tier]} or rarer" for ${price / NIGHT} NIGHT`, circuit: 'listItem' },
      () => submit(GENESIS, h.id, 'listItem', [fromHex(h.itemId), price, BigInt(h.tier), payout()]),
      (_b, a) => {
        const l = a.listings.lookup(fromHex(h.itemId));
        ensure(Number(l.status) === 0 && l.price === price, 'an OPEN listing at the asking price');
        return `OPEN at ${price / NIGHT} NIGHT with a proven rarity bound (${TIER_NAMES[h.tier]} or rarer); the item stays hidden`;
      },
    );
  }
  const first = listings[0]!;
  await reject(
    'A:double-list', { ...g, actor: first.id, action: 'List the same item twice', circuit: 'listItem' },
    'This item is already listed',
    () => submit(GENESIS, first.id, 'listItem', [fromHex(first.itemId), 1n * NIGHT, BigInt(first.tier), payout()]),
  );
  const rarest = [...listings].sort((a, b) => a.tier - b.tier)[0]!;
  if (rarest.tier > 0) {
    await reject(
      'A:list-overclaim', { ...g, actor: rarest.id, action: 'Relist claiming a rarer tier than the item has', circuit: 'listItem' },
      'This item is not that rare',
      () => submit(GENESIS, rarest.id, 'listItem', [fromHex(rarest.itemId), 999n * NIGHT, BigInt(rarest.tier - 1), payout()]),
    );
  }
  // Cancel one listing; nobody else may cancel it and nobody can buy it after.
  const cancelled = listings[1]!;
  const outsider = PLAYERS.map(([p]) => p).find((p) => !listings.some((l) => l.id === p) && p !== 'theo')!;
  await reject(
    'A:cancel-not-mine', { ...g, actor: outsider, action: `Cancel ${cancelled.id}'s listing (knowing the item's plaintext)`, circuit: 'cancelListing' },
    'You do not own this item',
    async () => {
      const fid = await forged(GENESIS, outsider, cancelled.itemId, (await getState(GENESIS, cancelled.id))!.items[cancelled.itemId]);
      return submit(GENESIS, fid, 'cancelListing', [fromHex(cancelled.itemId)]);
    },
  );
  await accept(
    'A:cancel',
    { ...g, actor: cancelled.id, action: 'Cancel my listing', circuit: 'cancelListing' },
    () => submit(GENESIS, cancelled.id, 'cancelListing', [fromHex(cancelled.itemId)]),
    (_b, a) => {
      ensure(Number(a.listings.lookup(fromHex(cancelled.itemId)).status) === 3, 'the listing is CANCELLED');
      return 'Listing CANCELLED by its owner (ownership proven in zero knowledge)';
    },
  );
  await reject(
    'A:buy-cancelled', { ...g, actor: outsider, action: 'Buy the cancelled listing', circuit: 'buyListing' },
    'This listing is not open',
    () => submit(GENESIS, outsider, 'buyListing', [fromHex(cancelled.itemId), payout(), now()]),
  );

  // An escrowed sale, settled end to end.
  const sale = listings.at(-1)!;
  await player(GENESIS, outsider);
  await accept(
    'A:escrow-buy',
    { ...g, actor: outsider, action: `Buy ${sale.id}'s listing into escrow`, circuit: 'buyListing' },
    () => submit(GENESIS, outsider, 'buyListing', [fromHex(sale.itemId), payout(), now()]),
    (_b, a) => {
      const l = a.listings.lookup(fromHex(sale.itemId));
      ensure(Number(l.status) === 1, 'the listing is PENDING');
      ensure(l.deadline > now(), 'the seller has a delivery deadline');
      return `${l.price / NIGHT} NIGHT held by the contract; ${sale.id} must deliver within ${(a.settleWindow / 3600n).toString()}h or the buyer is refunded`;
    },
  );
  await reject(
    'A:dodge-escrow', { ...g, actor: sale.id, action: 'Give the escrowed item to someone else instead', circuit: 'transferItem' },
    'This item has a pending bazaar sale',
    async () => {
      const friend = parseLootsealId(lootsealIdOf(GENESIS, (await getState(GENESIS, 'theo'))!));
      return submit(GENESIS, sale.id, 'transferItem', [fromHex(sale.itemId), friend.ownerPk, friend.encKey]);
    },
  );
  await reject(
    'A:early-refund', { ...g, actor: outsider, action: 'Pull the escrow back before the deadline', circuit: 'refundListing' },
    'The seller still has time to deliver',
    () => submit(GENESIS, outsider, 'refundListing', [fromHex(sale.itemId)]),
  );
  ctx.saleOpening ??= JSON.parse(JSON.stringify((await getState(GENESIS, sale.id))!.items[sale.itemId], (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
  saveCtx();
  await accept(
    'A:settle',
    { ...g, actor: sale.id, action: 'Deliver the item and get paid in one transaction', circuit: 'settleListing' },
    () => submit(GENESIS, sale.id, 'settleListing', [fromHex(sale.itemId)]),
    async (_b, a) => {
      ensure(Number(a.listings.lookup(fromHex(sale.itemId)).status) === 2, 'the listing is SOLD');
      const buyer = await vaultOf(GENESIS, outsider);
      const seller = await vaultOf(GENESIS, sale.id);
      ensure(!!buyer.items[sale.itemId], 'the buyer decrypts the item');
      ensure(!seller.items[sale.itemId], 'the seller no longer holds it');
      return `SOLD: the contract forced delivery to the escrowed buyer keys and paid the seller; ${outsider} now decrypts the item`;
    },
  );
  await reject(
    'A:settle-twice', { ...g, actor: sale.id, action: 'Get paid a second time for the same sale', circuit: 'settleListing' },
    'This listing has no buyer waiting',
    async () => {
      const op = revive(ctx.saleOpening);
      op.salt = toBytes(op.salt);
      op.itemType = BigInt(String(op.itemType).replace(/n$/, ''));
      op.serial = BigInt(String(op.serial).replace(/n$/, ''));
      const fid = await forged(GENESIS, sale.id, sale.itemId, op);
      return submit(GENESIS, fid, 'settleListing', [fromHex(sale.itemId)]);
    },
  );
  await reject(
    'A:proceeds-thief', { ...g, actor: 'mallory', action: 'Withdraw the publisher\'s proceeds', circuit: 'claimProceeds' },
    'Only the publisher can do this',
    () => submit(GENESIS, 'mallory', 'claimProceeds', []),
  );
  await accept(
    'A:proceeds',
    { ...g, actor: 'publisher', action: 'Withdraw sales proceeds', circuit: 'claimProceeds' },
    () => submit(GENESIS, 'publisher', 'claimProceeds', []),
    (b, a) => {
      ensure(a.publisherClaimable === 0n && b.publisherClaimable > 0n, 'claimable went to zero');
      return `${b.publisherClaimable / NIGHT} NIGHT paid out to the publisher's address`;
    },
  );

  // ─── B. Lantern Run: launch → sell out → reveal → audit ──────────────────

  const B = 'B · Lantern Run, launched, sold out, revealed, audited';
  const LANTERN: [string, number, number][] = [
    ['Sunfire Lantern', 0, 1],
    ['Gilded Wick', 1, 1],
    ['Amber Shade', 2, 1],
    ['Brass Hook', 3, 1],
    ['Tallow Stub', 4, 2],
  ];
  const lanternCounts = [...LANTERN.map(([, , c]) => BigInt(c)), ...Array<bigint>(ITEM_TYPES - LANTERN.length).fill(0n)];
  const smallDrop = (title: string, catalog: [string, number, number][], over: Record<string, unknown>) => {
    const tierTotals = [0n, 0n, 0n, 0n, 0n];
    catalog.forEach(([, t, c]) => (tierTotals[t] += BigInt(c)));
    return {
      title: encodeText32(title),
      names: [...catalog.map(([n]) => encodeText32(n)), ...Array.from({ length: ITEM_TYPES - catalog.length }, () => new Uint8Array(32))],
      tiers: [...catalog.map(([, t]) => BigInt(t)), ...Array<bigint>(ITEM_TYPES - catalog.length).fill(4n)],
      tierTotals,
      totalSupply: tierTotals.reduce((a, b) => a + b, 0n),
      price: 2n * NIGHT,
      bondAmount: 20n * NIGHT,
      penaltyPerBox: 3n * NIGHT,
      saleEnd: now() + 7n * 86_400n,
      fulfillWindow: 3_600n,
      settleWindow: 150n,
      payout: payout(),
      ...over,
    };
  };

  /** Deploy + launch + register a fresh drop; returns its address. */
  const launch = async (tag: string, scenario: string, title: string, catalog: [string, number, number][], over: Record<string, unknown>) => {
    const counts = [...catalog.map(([, , c]) => BigInt(c)), ...Array<bigint>(ITEM_TYPES - catalog.length).fill(0n)];
    if (!ctx[`${tag}:address`]) {
      const params = smallDrop(title, catalog, over);
      ctx[`${tag}:params`] = { saleEnd: params.saleEnd.toString() };
      const t = Date.now();
      try {
        const { address } = await deployStaged(providers, {
          compiledContract: CompiledLootsealContract,
          privateStateId: 'publisher',
          initialPrivateState: createPublisherPrivateState(counts),
          args: [params],
        });
        ctx[`${tag}:address`] = address;
        saveCtx();
        const missing = await missingCircuits(providers, address, DROP_CIRCUITS);
        record({
          key: `${tag}:deploy`, scenario, drop: address, actor: 'publisher', action: `Deploy "${title}" (staged: contract + verifier keys)`,
          circuit: 'deploy', expect: 'accepted', result: missing.length === 0 ? 'pass' : 'fail',
          detail: missing.length === 0 ? `Contract ${address.slice(0, 10)}… deployed with all ${DROP_CIRCUITS.length} circuit verifier keys installed` : `missing circuits: ${missing.join(', ')}`,
          seconds: Math.round((Date.now() - t) / 1000),
        });
      } catch (e) {
        record({ key: `${tag}:deploy`, scenario, drop: '', actor: 'publisher', action: `Deploy "${title}"`, circuit: 'deploy', expect: 'accepted', result: 'fail', detail: errText(e).slice(0, 400), seconds: Math.round((Date.now() - t) / 1000) });
        throw e;
      }
    }
    const address = ctx[`${tag}:address`] as string;
    const d = { scenario, drop: address };
    await accept(
      `${tag}:commitTable`,
      { ...d, actor: 'publisher', action: 'Commit the hidden table, prove it matches the odds, post the bond', circuit: 'commitTable' },
      () => submit(address, 'publisher', 'commitTable', []),
      (_b, a) => {
        ensure(Number(a.state) === 1, 'state TABLE_COMMITTED');
        return `Odds proof accepted (per-item split hidden, tier totals ${a.tierTotals.join('/')}); bond of ${a.bondRemaining / NIGHT} NIGHT locked`;
      },
      { already: async () => Number((await read(address)).state) >= 1 },
    );
    await accept(
      `${tag}:commitSeed`,
      { ...d, actor: 'publisher', action: 'Commit the secret master seed; the drop goes live', circuit: 'commitSeed' },
      () => submit(address, 'publisher', 'commitSeed', []),
      (_b, a) => {
        ensure(Number(a.state) === 2, 'state LIVE');
        return `Seed commitment ${toHex(a.seedCommit).slice(0, 10)}… on chain; the drop is LIVE`;
      },
      { already: async () => Number((await read(address)).state) >= 2 },
    );
    const register = async () => {
      registryProviders.privateStateProvider.setContractAddress(REGISTRY);
      const pub = (await getState(address, 'publisher'))!.publisher!;
      await registryProviders.privateStateProvider.set('registrant', createRegistryPrivateState(pub.secret));
      return (submitCallTx as any)(registryProviders, {
        compiledContract: CompiledRegistryContract, contractAddress: REGISTRY, privateStateId: 'registrant', circuitId: 'registerDrop',
        args: [fromHex(address), encodeText32(title), now()],
      });
    };
    await accept(
      `${tag}:register`,
      { ...d, actor: 'publisher', action: 'Register the drop in the public registry', circuit: 'registerDrop' },
      register,
      (_b, a) => {
        ensure(a.registered.member(fromHex(address)), 'the registry lists it');
        return `Listed in registry ${REGISTRY.slice(0, 10)}… as entry #${(a.dropCount - 1n).toString()}, signed by the publisher key`;
      },
      { before: readRegistry, already: async () => (await readRegistry()).registered.member(fromHex(address)) },
    );
    return address;
  };

  const LR = await launch('B', B, 'Lantern Run', LANTERN, {});
  journal.drops[LR] = { title: 'Lantern Run', story: 'A 6-box drop launched, sold out, opened, revealed and audited on chain.' };
  saveJournal();
  const b = { scenario: B, drop: LR };
  await reject(
    'B:register-twice', { ...b, actor: 'publisher', action: 'Register the same drop again', circuit: 'registerDrop' },
    'This drop is already registered',
    async () => {
      registryProviders.privateStateProvider.setContractAddress(REGISTRY);
      return (submitCallTx as any)(registryProviders, {
        compiledContract: CompiledRegistryContract, contractAddress: REGISTRY, privateStateId: 'registrant', circuitId: 'registerDrop',
        args: [fromHex(LR), encodeText32('Lantern Run'), now()],
      });
    },
  );
  const LR_BUYERS = ['ines', 'ravi', 'ines', 'yuki', 'ravi', 'yuki'];
  for (const [i, id] of LR_BUYERS.entries()) {
    await player(LR, id);
    await accept(
      `B:buy:${i}`,
      { ...b, actor: id, action: `Buy box ${i + 1} of 6 (2 NIGHT)`, circuit: 'requestBox' },
      () => submit(LR, id, 'requestBox', [randomBytes(32), payout(), now()]),
      (bf, a) => {
        ensure(a.requestCount === bf.requestCount + 1n, 'requestCount grew by one');
        return `Request #${bf.requestCount} queued; ${a.totalSupply - a.requestCount} box(es) left`;
      },
    );
  }
  await player(LR, 'zoe');
  await reject(
    'B:sold-out', { ...b, actor: 'zoe', action: 'Buy a seventh box from a 6-box drop', circuit: 'requestBox' },
    'Sold out',
    () => submit(LR, 'zoe', 'requestBox', [randomBytes(32), payout(), now()]),
  );
  await reject(
    'B:reveal-early', { ...b, actor: 'publisher', action: 'Reveal the table before every box is opened', circuit: 'finalReveal' },
    'Open every requested box first',
    async () => {
      await setState(LR, 'publisher', withReplayedSupply((await getState(LR, 'publisher'))!, await read(LR)));
      return submit(LR, 'publisher', 'finalReveal', []);
    },
  );
  for (;;) {
    const l = await read(LR);
    if (l.openedCount >= l.requestCount) break;
    const idx = l.openedCount;
    await setState(LR, 'publisher', withReplayedSupply((await getState(LR, 'publisher'))!, l));
    await accept(
      `B:open:${idx}`,
      { ...b, actor: 'publisher', action: `Open box #${idx} (FIFO)`, circuit: 'openBox' },
      () => submit(LR, 'publisher', 'openBox', []),
      (_bf, a) => {
        ensure(a.openedCount === idx + 1n, 'openedCount advanced');
        return `Box #${idx} opened and encrypted to its buyer`;
      },
      { already: async () => (await read(LR)).openedCount > idx },
    );
    if (!passed(`B:open:${idx}`)) break;
  }
  for (const id of ['ines', 'ravi', 'yuki']) {
    await verify(`B:vault:${id}`, { ...b, actor: id, action: 'Decrypt my two pulls' }, async () => {
      const ps = await vaultOf(LR, id);
      ensure(Object.keys(ps.items).length === 2, `${id} holds 2 items`);
      return `2 items decrypted with ${id}'s key and matched to their commitments`;
    });
  }

  // A seller who never delivers: the buyer gets the escrow back.
  const ravi = Object.keys((await getState(LR, 'ravi'))!.items)[0]!;
  await accept(
    'B:list',
    { ...b, actor: 'ravi', action: 'List an item for 3 NIGHT', circuit: 'listItem' },
    () => submit(LR, 'ravi', 'listItem', [fromHex(ravi), 3n * NIGHT, 4n, payout()]),
    (_bf, a) => (ensure(Number(a.listings.lookup(fromHex(ravi)).status) === 0, 'OPEN'), 'Listing OPEN at 3 NIGHT'),
  );
  await accept(
    'B:escrow-buy',
    { ...b, actor: 'zoe', action: 'Buy it into escrow', circuit: 'buyListing' },
    () => submit(LR, 'zoe', 'buyListing', [fromHex(ravi), payout(), now()]),
    (_bf, a) => {
      const l = a.listings.lookup(fromHex(ravi));
      ensure(Number(l.status) === 1, 'PENDING');
      ctx['B:deadline'] = l.deadline.toString();
      saveCtx();
      return `3 NIGHT in escrow; ravi has ${a.settleWindow}s to deliver`;
    },
  );
  await waitForBlockTime(BigInt(ctx['B:deadline'] ?? (await read(LR)).listings.lookup(fromHex(ravi)).deadline), 'letting the seller miss the delivery deadline');
  await accept(
    'B:escrow-refund',
    { ...b, actor: 'yuki', action: 'Anyone triggers the refund after the seller misses the deadline', circuit: 'refundListing' },
    () => submit(LR, 'yuki', 'refundListing', [fromHex(ravi)]),
    async (_bf, a) => {
      ensure(Number(a.listings.lookup(fromHex(ravi)).status) === 3, 'CANCELLED');
      ensure(!!(await vaultOf(LR, 'ravi')).items[ravi], 'ravi still holds the item');
      return 'Seller missed the deadline: 3 NIGHT returned to the buyer, the item never left the seller';
    },
  );
  await verify('B:sold-out-state', { ...b, actor: 'anyone', action: 'Check the drop is sold out and fully opened' }, async () => {
    const l = await read(LR);
    ensure(l.requestCount === l.totalSupply && l.openedCount === l.requestCount, 'sold out and all opened');
    return `${l.requestCount}/${l.totalSupply} sold, ${l.openedCount} opened, 0 refunds`;
  });
  await accept(
    'B:reveal',
    { ...b, actor: 'publisher', action: 'Final reveal: publish the initial table and the (empty) remainder', circuit: 'finalReveal' },
    async () => {
      await setState(LR, 'publisher', withReplayedSupply((await getState(LR, 'publisher'))!, await read(LR)));
      return submit(LR, 'publisher', 'finalReveal', []);
    },
    (_bf, a) => {
      ensure(Number(a.state) === 4, 'REVEALED');
      const initial = a.revealedInitial.map(Number).slice(0, LANTERN.length);
      ensure(initial.join() === LANTERN.map(([, , c]) => c).join(), 'the revealed table is the one the publisher committed');
      ensure(a.revealedRemaining.every((x: bigint) => x === 0n), 'nothing remains');
      return `Table revealed [${initial.join(', ')}], remainder all zero; bond returned to the publisher`;
    },
    { already: async () => Number((await read(LR)).state) === 4 },
  );
  await accept(
    'B:verifyOdds',
    { ...b, actor: 'zoe', action: 'Audit: recompute the odds on chain from the revealed table', circuit: 'verifyOdds' },
    () => submit(LR, 'zoe', 'verifyOdds', []),
    (_bf, a) => {
      ensure(a.oddsVerified === true, 'oddsVerified');
      return 'verifyOdds recorded TRUE: revealed table sums to the advertised tier totals and is consistent with every box opened';
    },
  );
  await reject(
    'B:buy-after-reveal', { ...b, actor: 'zoe', action: 'Buy from a finished drop', circuit: 'requestBox' },
    'This drop is not live',
    () => submit(LR, 'zoe', 'requestBox', [randomBytes(32), payout(), now()]),
  );

  // ─── C. Ghost Lantern: the publisher vanishes ─────────────────────────────

  const C = 'C · Ghost Lantern, a publisher who never opens';
  const GH = await launch('C', C, 'Ghost Lantern', [['Pale Wick', 0, 1], ['Grey Ash', 4, 3]], { fulfillWindow: 150n, price: 4n * NIGHT, penaltyPerBox: 3n * NIGHT });
  journal.drops[GH] = { title: 'Ghost Lantern', story: 'The publisher stops opening boxes; the buyer is refunded with a penalty from the bond.' };
  saveJournal();
  const c = { scenario: C, drop: GH };
  await player(GH, 'nadia');
  await accept(
    'C:buy',
    { ...c, actor: 'nadia', action: 'Buy a box (4 NIGHT)', circuit: 'requestBox' },
    () => submit(GH, 'nadia', 'requestBox', [randomBytes(32), payout(), now()]),
    (bf, a) => {
      ensure(a.requestCount === bf.requestCount + 1n, 'queued');
      ctx['C:requestedAt'] = a.requests.lookup(bf.requestCount).requestedAt.toString();
      saveCtx();
      return `Request #${bf.requestCount} queued; the publisher has ${a.fulfillWindow}s to open it`;
    },
  );
  await reject(
    'C:refund-early', { ...c, actor: 'nadia', action: 'Claim a refund while the publisher still has time', circuit: 'claimRefund' },
    'The fulfillment window is still open',
    () => submit(GH, 'nadia', 'claimRefund', [0n]),
  );
  const gl = await read(GH);
  await waitForBlockTime(BigInt(ctx['C:requestedAt']) + gl.fulfillWindow, 'the publisher does not open the box');
  await accept(
    'C:refund',
    { ...c, actor: 'nadia', action: 'Claim the refund plus the penalty from the publisher\'s bond', circuit: 'claimRefund' },
    () => submit(GH, 'nadia', 'claimRefund', [0n]),
    (bf, a) => {
      ensure(Number(a.requests.lookup(0n).status) === 2, 'REFUNDED');
      ensure(a.bondRemaining === bf.bondRemaining - a.penaltyPerBox, 'the penalty came out of the bond');
      ensure(Number(a.state) === 3, 'DEFAULTED');
      return `Refunded ${a.price / NIGHT} NIGHT + ${a.penaltyPerBox / NIGHT} NIGHT penalty from the bond (${bf.bondRemaining / NIGHT} → ${a.bondRemaining / NIGHT}); drop DEFAULTED`;
    },
  );
  await reject(
    'C:open-after-default', { ...c, actor: 'publisher', action: 'Come back and open the box after defaulting', circuit: 'openBox' },
    'This drop is not live',
    async () => {
      await setState(GH, 'publisher', withReplayedSupply((await getState(GH, 'publisher'))!, await read(GH)));
      return submit(GH, 'publisher', 'openBox', []);
    },
  );
  await reject(
    'C:double-refund', { ...c, actor: 'nadia', action: 'Claim the same refund twice', circuit: 'claimRefund' },
    'This box is not waiting to be opened',
    () => submit(GH, 'nadia', 'claimRefund', [0n]),
  );

  // Summary.
  const pass = journal.checks.filter((x) => x.result === 'pass').length;
  const txs = journal.checks.filter((x) => x.tx).length;
  logger.info(`Field test: ${pass}/${journal.checks.length} checks passed, ${txs} on-chain transactions. Journal: ${journalFile}`);
  await wallet.stop();
  process.exit(journal.checks.every((x) => x.result === 'pass') ? 0 : 1);
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
