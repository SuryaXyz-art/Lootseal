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

// Witnesses for lootseal.compact: the off-chain half of every circuit. Every
// value returned here is checked by the circuit that asked for it (the roll
// reduction, the item pick, every opening against its commitment), so a
// lying witness can only make a call fail, never make it succeed wrongly.
//
// Browser-safe: no `node:*` imports. Randomness comes from Web Crypto, which
// Node 22 also provides as globalThis.crypto.
import {
  type Ledger,
  type ItemOpening,
  type SeedOpening,
  type SupplyOpening,
  type TableOpening,
} from './managed/lootseal/contract/index.js';
import { type WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

export const ITEM_TYPES = 16;
export const TIERS = 5;

/** Everything a publisher must keep to run (and later reveal) a drop. */
export type PublisherSecrets = {
  /** Authorises publisher-only circuits (hashed with the drop address on chain). */
  secret: Uint8Array;
  /** Jubjub scalar; its public point encrypts every item delivered to buyers. */
  encSecret: bigint;
  /** The hidden drop table and its blinding salt. */
  table: TableOpening;
  /** The current hidden remaining/minted supply (updated by every openBox). */
  supply: SupplyOpening;
  /** The master seed mixed into every draw. Never revealed. */
  seed: SeedOpening;
};

/**
 * Private state of one participant for one drop. Holders (buyers, owners,
 * bazaar buyers) use holderSecret/holderEncSecret and the item book; the
 * publisher also carries `publisher`.
 */
export type LootsealPrivateState = {
  holderSecret: Uint8Array;
  holderEncSecret: bigint;
  /** Decrypted openings of the items this holder owns, keyed by itemId hex. */
  items: Record<string, ItemOpening>;
  publisher: PublisherSecrets | null;
};

// ─── Randomness helpers ─────────────────────────────────────────────────────

export const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
};

/**
 * A uniformly random 248-bit scalar. 2^248 is below the Jubjub subgroup order
 * (~2^251.9), so every value is a valid, distinct secret key.
 */
export const randomScalar = (): bigint => {
  const b = randomBytes(31);
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x === 0n ? 1n : x;
};

export const toHex = (u: Uint8Array): string =>
  Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (h: string): Uint8Array => {
  const clean = h.startsWith('0x') ? h.slice(2) : h;
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error('invalid hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

// ─── Private-state factories ────────────────────────────────────────────────

/** A fresh holder identity (anyone who buys, receives or trades items). */
export const createLootsealPrivateState = (): LootsealPrivateState => ({
  holderSecret: randomBytes(32),
  holderEncSecret: randomScalar(),
  items: {},
  publisher: null,
});

/**
 * Publisher secrets for a new drop with the given hidden per-type supply.
 * The initial supply opening mirrors what commitTable() writes on chain:
 * remaining = counts, minted = 0, salt = resalt(table salt); commitTable
 * also hands it back through saveSupply, so both stay identical.
 */
export const createPublisherSecrets = (counts: bigint[]): PublisherSecrets => {
  if (counts.length !== ITEM_TYPES) throw new Error(`counts must have ${ITEM_TYPES} entries`);
  return {
    secret: randomBytes(32),
    encSecret: randomScalar(),
    table: { counts: [...counts], salt: randomBytes(32) },
    supply: { remaining: [...counts], minted: new Array(ITEM_TYPES).fill(0n), salt: new Uint8Array(32) },
    seed: { seed: randomBytes(32), salt: randomBytes(32) },
  };
};

export const createPublisherPrivateState = (counts: bigint[]): LootsealPrivateState => ({
  ...createLootsealPrivateState(),
  publisher: createPublisherSecrets(counts),
});

/** Adds a decrypted item opening to the holder's book (returns a new state). */
export const withItem = (ps: LootsealPrivateState, itemIdHex: string, opening: ItemOpening): LootsealPrivateState => ({
  ...ps,
  items: { ...ps.items, [itemIdHex]: opening },
});

export const withoutItem = (ps: LootsealPrivateState, itemIdHex: string): LootsealPrivateState => {
  const items = { ...ps.items };
  delete items[itemIdHex];
  return { ...ps, items };
};

// ─── Pure helpers (also used by the UI and the fulfiller) ───────────────────

/** floor(a / d) and a mod d, the off-chain half of openBox's roll reduction. */
export const divMod = (a: bigint, d: bigint): [bigint, bigint] => {
  if (d <= 0n) throw new Error('division by zero');
  return [a / d, a % d];
};

/** The item type whose slice of the remaining supply contains `roll`. */
export const pickItemType = (roll: bigint, remaining: bigint[]): bigint => {
  let before = 0n;
  for (const [i, count] of remaining.entries()) {
    if (roll < before + count) return BigInt(i);
    before += count;
  }
  throw new Error('roll is outside the remaining supply');
};

const requirePublisher = (ps: LootsealPrivateState): PublisherSecrets => {
  if (!ps.publisher) throw new Error('This wallet holds no publisher secrets for this drop');
  return ps.publisher;
};

type Ctx = WitnessContext<Ledger, LootsealPrivateState>;

export const witnesses = {
  publisherSecret: ({ privateState }: Ctx): [LootsealPrivateState, Uint8Array] => [
    privateState,
    requirePublisher(privateState).secret,
  ],
  publisherEncSecret: ({ privateState }: Ctx): [LootsealPrivateState, bigint] => [
    privateState,
    requirePublisher(privateState).encSecret,
  ],
  tableOpening: ({ privateState }: Ctx): [LootsealPrivateState, TableOpening] => [
    privateState,
    requirePublisher(privateState).table,
  ],
  supplyOpening: ({ privateState }: Ctx): [LootsealPrivateState, SupplyOpening] => [
    privateState,
    requirePublisher(privateState).supply,
  ],
  seedOpening: ({ privateState }: Ctx): [LootsealPrivateState, SeedOpening] => [
    privateState,
    requirePublisher(privateState).seed,
  ],
  // The circuit hands back the supply it just committed on chain; keeping it
  // is what lets the next openBox (or finalReveal) open the new commitment.
  saveSupply: ({ privateState }: Ctx, next: SupplyOpening): [LootsealPrivateState, []] => [
    { ...privateState, publisher: { ...requirePublisher(privateState), supply: next } },
    [],
  ],
  divMod64: ({ privateState }: Ctx, a: bigint, d: bigint): [LootsealPrivateState, [bigint, bigint]] => [
    privateState,
    divMod(a, d),
  ],
  pickType: ({ privateState }: Ctx, roll: bigint, remaining: bigint[]): [LootsealPrivateState, bigint] => [
    privateState,
    pickItemType(roll, remaining),
  ],
  holderSecret: ({ privateState }: Ctx): [LootsealPrivateState, Uint8Array] => [privateState, privateState.holderSecret],
  holderEncSecret: ({ privateState }: Ctx): [LootsealPrivateState, bigint] => [
    privateState,
    privateState.holderEncSecret,
  ],
  itemOpening: ({ privateState }: Ctx, itemId: Uint8Array): [LootsealPrivateState, ItemOpening] => {
    const opening = privateState.items[toHex(itemId)];
    if (!opening) throw new Error('This item is not in your vault');
    return [privateState, opening];
  },
  ephemeralSecret: ({ privateState }: Ctx): [LootsealPrivateState, bigint] => [privateState, randomScalar()],
};

export type { Ledger, WitnessContext };
