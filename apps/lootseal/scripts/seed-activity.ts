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

// Plays a launched drop like a small community would, on a real network:
// players buy boxes with their own seeds, the publisher opens them in order,
// players decrypt their items, prove rarity, gift one, and trade on the
// bazaar (open listings plus one escrowed sale settled end to end).
//
//   MIDNIGHT_NETWORK=preview LOOTSEAL_STATE_STORE=<deploy store> yarn activity
//
// One funded wallet pays every fee (as in the devnet suite); each player is
// a separate private identity with its own keys in the private-state store.
// The publisher's secrets come from the store the deploy wrote. Progress is
// recorded per step in .secrets/<network>/activity.json, so a rerun resumes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
import { CompiledLootsealContract, ledger, pureCircuits, zkConfigPath } from '../contract/index.js';
import {
  createLootsealPrivateState,
  fromHex,
  randomBytes,
  toHex,
  type LootsealPrivateState,
} from '../contract/witnesses.js';
import { encodeText32, lootsealIdOf, parseLootsealId, syncVault, TIER_NAMES, withReplayedSupply } from '../contract/lib.js';

// @ts-expect-error WebSocket global for the indexer client in Node
globalThis.WebSocket = WebSocket;

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });
const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const root = path.resolve(new URL(import.meta.url).pathname, '../..');
const secretsDir = path.join(root, '.secrets', network);
const deployment = JSON.parse(readFileSync(path.join(root, 'deployments', `${network}.json`), 'utf8')) as {
  drops: { address: string; title: string }[];
};
const DROP = (process.env['DROP_ADDRESS'] ?? deployment.drops[0]!.address) as ContractAddress;
const NIGHT = 1_000_000n;

// Who buys how many boxes.
const PLAYERS: [string, number][] = [
  ['aria', 2],
  ['kenji', 2],
  ['lena', 1],
  ['omar', 2],
  ['sofia', 1],
  ['devi', 1],
  ['mia', 1],
  ['theo', 2],
];
// Asking price per tier on the bazaar, in NIGHT.
const LIST_PRICE = [420n, 128n, 36n, 14n, 7n];
const BADGE_CONTEXT = 'Genesis showcase';

const progressFile = path.join(secretsDir, 'activity.json');
const progress: Record<string, unknown> = existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, 'utf8')) : {};
const save = () => writeFileSync(progressFile, JSON.stringify(progress, null, 2), { mode: 0o600 });

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
  const payout = () => ({ bytes: encodeUserAddress(wallet.unshieldedKeystore.getAddress()) });
  const now = () => BigInt(Math.floor(Date.now() / 1000));

  const read = async () => ledger((await providers.publicDataProvider.queryContractState(DROP))!.data);
  const getState = async (id: string) => {
    providers.privateStateProvider.setContractAddress(DROP);
    return (await providers.privateStateProvider.get(id)) as LootsealPrivateState | null;
  };
  const setState = async (id: string, ps: LootsealPrivateState) => {
    providers.privateStateProvider.setContractAddress(DROP);
    await providers.privateStateProvider.set(id, ps);
  };
  const call = (id: string, circuitId: string, args: unknown[]) =>
    (submitCallTx as any)(providers, { compiledContract: CompiledLootsealContract, contractAddress: DROP, privateStateId: id, circuitId, args });
  /** Runs `fn` once per key across reruns. */
  const step = async (key: string, label: string, fn: () => Promise<unknown>) => {
    if (progress[key]) return;
    const t = Date.now();
    await fn();
    progress[key] = new Date().toISOString();
    save();
    logger.info(`✓ ${label} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  };
  const vaultOf = async (id: string) => {
    const next = syncVault(DROP, (await getState(id))!, await read());
    await setState(id, next);
    return next;
  };

  if (!(await getState('publisher'))?.publisher) throw new Error('No publisher secrets in this store: set LOOTSEAL_STATE_STORE to the deploy store');

  // 1. Players buy boxes.
  for (const [id, boxes] of PLAYERS) {
    if (!(await getState(id))) await setState(id, createLootsealPrivateState());
    for (let i = 0; i < boxes; i++) await step(`buy:${id}:${i}`, `${id} bought a box`, () => call(id, 'requestBox', [randomBytes(32), payout(), now()]));
  }

  // 2. The publisher opens every pending box, in order.
  for (;;) {
    const l = await read();
    if (l.openedCount >= l.requestCount) break;
    const t = Date.now();
    const ps = (await getState('publisher'))!;
    await setState('publisher', withReplayedSupply(ps, l));
    await call('publisher', 'openBox', []);
    logger.info(`✓ publisher opened box #${l.openedCount.toString()} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  }

  // 3. Everyone decrypts their deliveries.
  const holdings: { id: string; itemId: string; tier: number; type: number }[] = [];
  for (const [id] of PLAYERS) {
    const ps = await vaultOf(id);
    for (const [itemId, op] of Object.entries(ps.items)) {
      const type = Number(op.itemType);
      const tier = Number((await read()).catalogTiers[type] ?? 4n);
      holdings.push({ id, itemId, tier, type });
      logger.info(`  ${id} holds a ${TIER_NAMES[tier]} item (type ${type}, #${op.serial.toString()})`);
    }
  }
  holdings.sort((a, b) => a.tier - b.tier);

  // 4. Rarity badges for the best pulls (Rare or better), or the top two.
  const showcase = holdings.filter((h) => h.tier <= 2).slice(0, 3);
  for (const h of showcase.length ? showcase : holdings.slice(0, 2)) {
    await step(`badge:${h.itemId}`, `${h.id} proved a ${TIER_NAMES[h.tier]}-or-rarer badge`, () =>
      call(h.id, 'proveRarityTier', [fromHex(h.itemId), BigInt(h.tier), encodeText32(BADGE_CONTEXT)]),
    );
  }

  // 5. A gift: theo sends his most common item to mia.
  const gift = holdings.filter((h) => h.id === 'theo').at(-1);
  if (gift) {
    await step(`gift:${gift.itemId}`, 'theo gifted an item to mia', async () => {
      const mia = parseLootsealId(lootsealIdOf(DROP, (await getState('mia'))!));
      await call('theo', 'transferItem', [fromHex(gift.itemId), mia.ownerPk, mia.encKey]);
    });
    await vaultOf('theo');
    await vaultOf('mia');
  }

  // 6. The bazaar: one listing per seller across the tiers, priced by rarity.
  const sellers = new Set<string>();
  const listings = holdings
    .filter((h) => h.itemId !== gift?.itemId && !sellers.has(h.id) && sellers.add(h.id))
    .slice(0, 5);
  for (const [i, h] of listings.entries()) {
    const price = (LIST_PRICE[h.tier]! + BigInt(i % 3)) * NIGHT;
    await step(`list:${h.itemId}`, `${h.id} listed a ${TIER_NAMES[h.tier]} item for ${price / NIGHT} NIGHT`, () =>
      call(h.id, 'listItem', [fromHex(h.itemId), price, BigInt(h.tier), payout()]),
    );
  }

  // 7. One escrowed sale, settled end to end: a player buys the cheapest
  //    listing and the seller delivers.
  const sale = listings.at(-1);
  const buyer = PLAYERS.map(([id]) => id).find((id) => id !== sale?.id && !listings.some((l) => l.id === id));
  if (sale && buyer) {
    await step(`buyListing:${sale.itemId}`, `${buyer} bought ${sale.id}'s listing into escrow`, () =>
      call(buyer, 'buyListing', [fromHex(sale.itemId), payout(), now()]),
    );
    await step(`settle:${sale.itemId}`, `${sale.id} delivered and was paid`, () => call(sale.id, 'settleListing', [fromHex(sale.itemId)]));
    await vaultOf(sale.id);
    await vaultOf(buyer);
  }

  // Summary with links anyone can open.
  const l = await read();
  const badges: string[] = [];
  for (const [badgeId] of l.badges) badges.push(toHex(badgeId as Uint8Array));
  logger.info(`Drop: ${l.requestCount} sold, ${l.openedCount} opened, ${badges.length} badge(s).`);
  for (const b of badges) logger.info(`  verify: #/verify/${DROP}/${b}`);
  void pureCircuits;
  await wallet.stop();
  process.exit(0);
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
