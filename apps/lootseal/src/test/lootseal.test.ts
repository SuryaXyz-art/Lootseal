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

// Devnet end-to-end suite: real proofs, real transactions, real NIGHT.
//
// One funded wallet pays every fee; the participants (publisher, alice, bob,
// carol) are separate private-state ids with their own Lootseal keys, the
// way zk-loan runs two identities from one wallet. The flow:
//   registry + drop deploy → commitTable → commitSeed → registerDrop →
//   3 boxes bought (sells out) → 3 opened → vaults decrypted → rarity badge →
//   gift → bazaar sale → proceeds → final reveal → verifyOdds,
// then a second drop with 1-second windows for the refund paths.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  type ContractAddress,
  encodeUserAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type LootsealProviders } from '../providers.js';
import {
  createLootsealPrivateState,
  createPublisherPrivateState,
  fromHex,
  randomBytes,
  toHex,
  type LootsealPrivateState,
} from '../../contract/witnesses.js';
import { createRegistryPrivateState } from '../../contract/registry-witnesses.js';
import {
  CompiledLootsealContract,
  CompiledRegistryContract,
  DropState,
  ListingStatus,
  RequestStatus,
  ledger,
  pureCircuits,
  registryLedger,
  registryZkConfigPath,
  zkConfigPath,
  type ImpureCircuits,
} from '../../contract/index.js';
import { DROP_CIRCUITS, encodeText32, lootsealIdOf, parseLootsealId, syncVault } from '../../contract/lib.js';
import { deployStaged, missingCircuits } from '../../contract/staged-deploy.js';
import { dropParams, type CatalogEntry } from './fixtures.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
type DropCircuit = keyof ImpureCircuits<unknown>;

// Three boxes, so the drop sells out and can be revealed straight away.
const CATALOG: CatalogEntry[] = Array.from({ length: 16 }, (_, i) => ({
  name: ['Dragon Sigil', 'Void Lantern', 'Copper Key'][i] ?? '',
  tier: [0, 1, 4][i] ?? 4,
  count: i < 3 ? 1 : 0,
}));

describe(`Lootseal Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: LootsealProviders;
  let registryProviders: LootsealProviders;
  let dropAddress: ContractAddress;
  let registryAddress: ContractAddress;
  const states = new Map<string, LootsealPrivateState>();

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const payout = () => ({ bytes: encodeUserAddress(wallet.unshieldedKeystore.getAddress()) });

  async function queryLedger(address = dropAddress) {
    const state = await providers.publicDataProvider.queryContractState(address);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  }

  // Loads a participant's private state into the store, keyed to `address`.
  async function setState(id: string, ps: LootsealPrivateState, address = dropAddress) {
    providers.privateStateProvider.setContractAddress(address);
    await providers.privateStateProvider.set(id, ps);
    states.set(id, ps);
  }

  async function getState(id: string, address = dropAddress): Promise<LootsealPrivateState> {
    providers.privateStateProvider.setContractAddress(address);
    const ps = (await providers.privateStateProvider.get(id)) as LootsealPrivateState | null;
    expect(ps).not.toBeNull();
    return ps!;
  }

  async function call<K extends DropCircuit>(id: string, circuitId: K, args: unknown[], address = dropAddress) {
    providers.privateStateProvider.setContractAddress(address);
    return (submitCallTx as any)(providers, {
      compiledContract: CompiledLootsealContract,
      contractAddress: address,
      privateStateId: id,
      circuitId,
      args,
    });
  }

  // Decrypts every delivery with the participant's keys and stores the result.
  async function syncVaultOf(id: string, address = dropAddress): Promise<string[]> {
    const next = syncVault(address, await getState(id, address), await queryLedger(address));
    await setState(id, next, address);
    return Object.keys(next.items);
  }

  const dump = (e: unknown, depth = 0): string => {
    if (depth > 6 || e == null || typeof e !== 'object') return String(e);
    const o = e as Record<string, unknown>;
    const keys = [...new Set([...Object.getOwnPropertyNames(o), ...Object.keys(o)])].filter((k) => k !== 'stack');
    const cause = (o as Record<symbol, unknown>)[Symbol.for('effect/Runtime/FiberFailure/Cause')];
    const own = keys.map((k) => `${k}: ${typeof o[k] === 'object' ? dump(o[k], depth + 1) : String(o[k])}`);
    if (cause) own.push(`effectCause: ${JSON.stringify(cause, (k, v) => (k === 'txData' ? '<tx>' : typeof v === 'bigint' ? v.toString() : v)).slice(0, 4000)}`);
    return `{${own.join(', ')}}`;
  };

  async function deployDrop(id: string, params = dropParams(CATALOG)) {
    const publisher = createPublisherPrivateState(CATALOG.map((c) => BigInt(c.count)));
    const { address } = await deployStaged(
      providers,
      {
        compiledContract: CompiledLootsealContract,
        privateStateId: id,
        initialPrivateState: publisher,
        args: [{ ...params, payout: payout() }],
      },
      (p) => logger.info(`staged deploy: ${JSON.stringify(p)}`),
    ).catch((e: unknown) => {
      console.error(`drop deploy failed: ${dump(e)}`);
      throw e;
    });
    states.set(id, publisher);
    expect(await missingCircuits(providers, address, DROP_CIRCUITS)).toEqual([]);
    return address;
  }

  beforeAll(async () => {
    setNetworkId(config.networkId);
    const envConfig: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };
    const setup = resolveWallet(network);
    wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret, { fastSync: setup.fastSync });
    await wallet.start();
    await syncWallet(logger, wallet.wallet, syncTimeoutMs);
    if (isRemote) {
      await waitForNightThenDust(logger, wallet.wallet, wallet.unshieldedKeystore, envConfig, config.faucet, {
        label: setup.role,
      });
    }
    providers = buildProviders(wallet, zkConfigPath, config);
    registryProviders = buildProviders(wallet, registryZkConfigPath, config);
    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    if (wallet) await wallet.stop();
  });

  // ─── Launch ───────────────────────────────────────────────────────────────

  it('deploys the registry and a drop', async () => {
    const reg = await (deployContract as any)(registryProviders, {
      compiledContract: CompiledRegistryContract,
      privateStateId: 'registrant',
      initialPrivateState: createRegistryPrivateState(new Uint8Array(32)),
    }).catch((e: unknown) => {
      console.error(`registry deploy failed: ${dump(e)}`);
      throw e;
    });
    registryAddress = reg.deployTxData.public.contractAddress;
    dropAddress = await deployDrop('publisher');
    logger.info(`Registry at ${registryAddress}, drop at ${dropAddress}`);
    expect(fromHex(dropAddress).length).toBe(32);
    const l = await queryLedger();
    expect(l.state).toBe(DropState.SETUP);
    expect(l.totalSupply).toBe(3n);
  });

  it('commitTable: proves the hidden table matches the odds and posts the bond', async () => {
    await call('publisher', 'commitTable', []);
    const l = await queryLedger();
    expect(l.state).toBe(DropState.TABLE_COMMITTED);
    const ps = await getState('publisher');
    expect(toHex(l.tableCommit)).toBe(toHex(pureCircuits.tableCommitOf(ps.publisher!.table)));
    expect(toHex(l.remainingCommit)).toBe(toHex(pureCircuits.supplyCommitOf(ps.publisher!.supply)));
  });

  it('commitSeed: makes the drop live', async () => {
    await call('publisher', 'commitSeed', []);
    expect((await queryLedger()).state).toBe(DropState.LIVE);
  });

  it('registerDrop: lists the drop with the key the drop itself stores', async () => {
    const secret = (await getState('publisher')).publisher!.secret;
    registryProviders.privateStateProvider.setContractAddress(registryAddress);
    await registryProviders.privateStateProvider.set('registrant', createRegistryPrivateState(secret));
    await (submitCallTx as any)(registryProviders, {
      compiledContract: CompiledRegistryContract,
      contractAddress: registryAddress,
      privateStateId: 'registrant',
      circuitId: 'registerDrop',
      args: [fromHex(dropAddress), encodeText32('Devnet Relics'), now()],
    });
    const state = await registryProviders.publicDataProvider.queryContractState(registryAddress);
    const reg = registryLedger(state!.data);
    expect(reg.dropCount).toBe(1n);
    const entry = reg.drops.lookup(0n);
    expect(toHex(entry.dropAddress)).toBe(dropAddress);
    expect(toHex(entry.publisherPk)).toBe(toHex((await queryLedger()).publisherPk));
  });

  // ─── Buying and opening ───────────────────────────────────────────────────

  it('requestBox ×3: three buyers pay and queue (sells out)', async () => {
    for (const id of ['alice', 'bob', 'carol']) {
      await setState(id, createLootsealPrivateState());
      await call(id, 'requestBox', [randomBytes(32), payout(), now()]);
    }
    const l = await queryLedger();
    expect(l.requestCount).toBe(3n);
    expect(l.requests.lookup(2n).status).toBe(RequestStatus.PENDING);
  });

  it('openBox ×3: the publisher opens every box in order', async () => {
    for (let i = 0; i < 3; i++) await call('publisher', 'openBox', []);
    const l = await queryLedger();
    expect(l.openedCount).toBe(3n);
    expect(l.publisherClaimable).toBe(3n * l.price);
  });

  it('each buyer decrypts exactly its own item; together they are the table', async () => {
    const types = new Set<bigint>();
    for (const id of ['alice', 'bob', 'carol']) {
      const vault = await syncVaultOf(id);
      expect(vault.length).toBe(1);
      types.add((await getState(id)).items[vault[0]].itemType);
    }
    expect([...types].sort()).toEqual([0n, 1n, 2n]);
  });

  // ─── Holding, gifting, trading ────────────────────────────────────────────

  it('proveRarityTier: alice proves her item is common-or-better without revealing it', async () => {
    const [item] = Object.keys((await getState('alice')).items);
    await call('alice', 'proveRarityTier', [fromHex(item), 4n, encodeText32('devnet')]);
    const badge = (await queryLedger()).badges.lookup(pureCircuits.badgeIdOf(fromHex(item), encodeText32('devnet'), 0n));
    expect(badge.maxTier).toBe(4n);
  });

  it('transferItem: alice gifts her item to a fresh holder, who can decrypt it', async () => {
    const [item] = Object.keys((await getState('alice')).items);
    await setState('dave', createLootsealPrivateState());
    const dave = parseLootsealId(lootsealIdOf(dropAddress, await getState('dave')));
    await call('alice', 'transferItem', [fromHex(item), dave.ownerPk, dave.encKey]);
    expect(await syncVaultOf('alice')).toEqual([]);
    expect(await syncVaultOf('dave')).toEqual([item]);
  });

  it('bazaar: bob lists, dave buys through escrow, bob settles', async () => {
    const [item] = Object.keys((await getState('bob')).items);
    await call('bob', 'listItem', [fromHex(item), 5n, 4n, payout()]);
    await call('dave', 'buyListing', [fromHex(item), payout(), now()]);
    expect((await queryLedger()).listings.lookup(fromHex(item)).status).toBe(ListingStatus.PENDING);
    await call('bob', 'settleListing', [fromHex(item)]);
    expect((await queryLedger()).listings.lookup(fromHex(item)).status).toBe(ListingStatus.SOLD);
    expect(await syncVaultOf('bob')).toEqual([]);
    expect((await syncVaultOf('dave')).length).toBe(2);
  });

  it('cancelListing: carol lists and cancels', async () => {
    const [item] = Object.keys((await getState('carol')).items);
    await call('carol', 'listItem', [fromHex(item), 9n, 4n, payout()]);
    await call('carol', 'cancelListing', [fromHex(item)]);
    expect((await queryLedger()).listings.lookup(fromHex(item)).status).toBe(ListingStatus.CANCELLED);
  });

  // ─── Closing ──────────────────────────────────────────────────────────────

  it('claimProceeds: the publisher is paid for the opened boxes', async () => {
    await call('publisher', 'claimProceeds', []);
    expect((await queryLedger()).publisherClaimable).toBe(0n);
  });

  it('finalReveal + verifyOdds: the sold-out table is opened and verified on chain', async () => {
    await call('publisher', 'finalReveal', []);
    let l = await queryLedger();
    expect(l.state).toBe(DropState.REVEALED);
    expect(l.revealedInitial).toEqual(CATALOG.map((c) => BigInt(c.count)));
    await setState('auditor', createLootsealPrivateState());
    await call('auditor', 'verifyOdds', []);
    l = await queryLedger();
    expect(l.oddsVerified).toBe(true);
  });

  // ─── Default path ─────────────────────────────────────────────────────────

  it('claimRefund + refundListing: late fulfillment and late delivery are refunded', async () => {
    const quick = await deployDrop('publisher2', dropParams(CATALOG, { fulfillWindow: 1n, settleWindow: 1n }));
    await call('publisher2', 'commitTable', [], quick);
    await call('publisher2', 'commitSeed', [], quick);
    await setState('erin', createLootsealPrivateState(), quick);
    await call('erin', 'requestBox', [randomBytes(32), payout(), now()], quick);
    await call('erin', 'requestBox', [randomBytes(32), payout(), now()], quick);
    await call('publisher2', 'openBox', [], quick);
    // Box 1 is never opened: after the window anyone can refund it.
    await new Promise((r) => setTimeout(r, 15_000));
    await setState('anyone', createLootsealPrivateState(), quick);
    await call('anyone', 'claimRefund', [1n], quick);
    let l = await queryLedger(quick);
    expect(l.requests.lookup(1n).status).toBe(RequestStatus.REFUNDED);
    expect(l.state).toBe(DropState.DEFAULTED);

    // Erin lists her item; frank pays; erin never settles → frank is refunded.
    const [item] = await syncVaultOf('erin', quick);
    await call('erin', 'listItem', [fromHex(item), 5n, 4n, payout()], quick);
    await setState('frank', createLootsealPrivateState(), quick);
    await call('frank', 'buyListing', [fromHex(item), payout(), now()], quick);
    await new Promise((r) => setTimeout(r, 15_000));
    await call('anyone', 'refundListing', [fromHex(item)], quick);
    l = await queryLedger(quick);
    expect(l.listings.lookup(fromHex(item)).status).toBe(ListingStatus.CANCELLED);
  });
});
