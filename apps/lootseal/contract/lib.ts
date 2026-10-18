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

// Shared, browser-safe Lootseal logic used by the tests, the web app and the
// fulfiller: text encoding for on-chain names, delivery decryption (built on
// the contract's own pure circuits, so the maths is identical to the proof),
// and odds arithmetic.
import {
  Contract,
  pureCircuits,
  type Delivery,
  type ItemOpening,
  type Ledger,
  type SupplyOpening,
} from './managed/lootseal/contract/index.js';
import {
  ITEM_TYPES,
  TIERS,
  fromHex,
  pickItemType,
  toHex,
  witnesses,
  type LootsealPrivateState,
  type PublisherSecrets,
} from './witnesses.js';

export { ITEM_TYPES, TIERS };

/** The scalar field modulus of the proof system (Compact's max Field + 1). */
export const FIELD_MODULUS =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** Every provable circuit of a drop (what a fully installed drop must have). */
export const DROP_CIRCUITS: string[] = Object.keys(
  (new Contract(witnesses) as unknown as { provableCircuits: Record<string, unknown> }).provableCircuits,
);

export const TIER_NAMES = ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'] as const;
export type TierName = (typeof TIER_NAMES)[number];

// ─── Bytes<32> text ─────────────────────────────────────────────────────────

/** UTF-8 encodes `text` into a zero-padded Bytes<32> (throws if too long). */
export const encodeText32 = (text: string): Uint8Array => {
  const raw = new TextEncoder().encode(text);
  if (raw.length > 32) throw new Error(`"${text}" is longer than 32 bytes`);
  const out = new Uint8Array(32);
  out.set(raw);
  return out;
};

/** Decodes a zero-padded Bytes<32> back to text. */
export const decodeText32 = (bytes: Uint8Array): string => {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
};

export const isEmpty32 = (bytes: Uint8Array): boolean => bytes.every((b) => b === 0);

// ─── Addresses ──────────────────────────────────────────────────────────────

/** kernel.self().bytes for a deployed contract address (hex). */
export const contractSelfBytes = (contractAddress: string): Uint8Array => {
  const bytes = fromHex(contractAddress);
  if (bytes.length !== 32) throw new Error(`expected a 32-byte contract address, got ${bytes.length} bytes`);
  return bytes;
};

// ─── Identity ───────────────────────────────────────────────────────────────

/** The holder's per-drop owner key, as the contract derives it. */
export const ownerKeyOf = (contractAddress: string, ps: LootsealPrivateState): Uint8Array =>
  pureCircuits.holderKey(contractSelfBytes(contractAddress), ps.holderSecret);

export const encKeyOf = (ps: LootsealPrivateState) => pureCircuits.encPublicKey(ps.holderEncSecret);

/**
 * A shareable "Lootseal ID" for receiving items in one drop:
 * `ls1:<ownerPk hex>:<encKey x hex>:<encKey y hex>`.
 */
export const lootsealIdOf = (contractAddress: string, ps: LootsealPrivateState): string => {
  const pk = ownerKeyOf(contractAddress, ps);
  const k = encKeyOf(ps);
  return `ls1:${toHex(pk)}:${k.x.toString(16)}:${k.y.toString(16)}`;
};

export const parseLootsealId = (id: string): { ownerPk: Uint8Array; encKey: { x: bigint; y: bigint } } => {
  const parts = id.trim().split(':');
  const [tag, pkHex = '', xHex = '', yHex = ''] = parts;
  if (parts.length !== 4 || tag !== 'ls1') throw new Error('Not a Lootseal ID (expected ls1:…)');
  const ownerPk = fromHex(pkHex);
  if (ownerPk.length !== 32) throw new Error('Lootseal ID has a malformed owner key');
  if (!/^[0-9a-f]+$/i.test(xHex) || !/^[0-9a-f]+$/i.test(yHex)) {
    throw new Error('Lootseal ID has a malformed encryption key');
  }
  return { ownerPk, encKey: { x: BigInt(`0x${xHex}`), y: BigInt(`0x${yHex}`) } };
};

// ─── Delivery decryption ────────────────────────────────────────────────────

const mod = (a: bigint): bigint => ((a % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS;

/**
 * Tries to open `delivery` for `itemId` with this holder's keys. Returns the
 * item opening only if it reproduces the on-chain commitment exactly, i.e.
 * the item is really owned by this holder; otherwise null. Trial decryption
 * of other people's deliveries therefore always returns null.
 */
export const tryDecryptDelivery = (
  contractAddress: string,
  ps: LootsealPrivateState,
  itemId: Uint8Array,
  delivery: Delivery,
  onChainCommit: Uint8Array,
): ItemOpening | null => {
  const shared = pureCircuits.sharedPoint(ps.holderEncSecret, delivery.ephemeral);
  const mask = pureCircuits.deliveryMask(shared, itemId, delivery.version);
  const packed = mod(delivery.cipher - mask);
  const itemType = packed >> 32n;
  const serial = packed & 0xffffffffn;
  if (itemType >= BigInt(ITEM_TYPES)) return null;
  const opening: ItemOpening = { itemType, serial, salt: pureCircuits.itemSalt(shared, itemId, delivery.version) };
  const commit = pureCircuits.itemCommit(opening, ownerKeyOf(contractAddress, ps));
  return toHex(commit) === toHex(onChainCommit) ? opening : null;
};

/**
 * Scans every item in the drop and returns the private state with the item
 * book replaced by exactly the items this holder currently owns.
 */
export const syncVault = (
  contractAddress: string,
  ps: LootsealPrivateState,
  ledger: Pick<Ledger, 'items' | 'deliveries'>,
): LootsealPrivateState => {
  const items: Record<string, ItemOpening> = {};
  for (const [itemId, commit] of ledger.items) {
    if (!ledger.deliveries.member(itemId)) continue;
    const opening = tryDecryptDelivery(contractAddress, ps, itemId, ledger.deliveries.lookup(itemId), commit);
    if (opening) items[toHex(itemId)] = opening;
  }
  return { ...ps, items };
};

// ─── Odds ───────────────────────────────────────────────────────────────────

/** Advertised probability of each tier, in percent. */
export const tierOdds = (tierTotals: bigint[], totalSupply: bigint): number[] =>
  tierTotals.map((t) => (totalSupply === 0n ? 0 : (Number(t) / Number(totalSupply)) * 100));

/** "Top X%" share for an item of `tier`: the cumulative odds of that tier or rarer. */
export const topShare = (tier: number, tierTotals: bigint[], totalSupply: bigint): number => {
  let cum = 0n;
  for (let t = 0; t <= tier; t++) cum += tierTotals[t] ?? 0n;
  return totalSupply === 0n ? 0 : (Number(cum) / Number(totalSupply)) * 100;
};

export const formatPercent = (p: number): string => {
  if (p === 0) return '0%';
  if (p < 0.1) return `${p.toFixed(2)}%`;
  if (p < 10) return `${p.toFixed(1).replace(/\.0$/, '')}%`;
  return `${Math.round(p)}%`;
};

/** Per-tier sums of a per-type count vector. */
export const sumByTier = (counts: bigint[], tiers: bigint[]): bigint[] => {
  const out = new Array<bigint>(TIERS).fill(0n);
  counts.forEach((c, i) => {
    const t = Number(tiers[i] ?? 0n);
    if (t < TIERS) out[t] = (out[t] ?? 0n) + c;
  });
  return out;
};

// ─── Publisher: rebuild the hidden supply from chain data ───────────────────

/**
 * Replays every opened box from the publisher's secrets and the public
 * request log, giving the exact supply opening the chain commits to now.
 * Every draw is deterministic (committed seed, public buyer seed, index), so
 * any copy of the publisher secrets (a browser, the fulfiller) can act on a
 * drop without sharing a mutable supply cache. Throws if the result does not
 * open `remainingCommit`, i.e. the secrets belong to another drop.
 */
export const replaySupply = (
  secrets: PublisherSecrets,
  ledger: Pick<Ledger, 'requests' | 'openedCount' | 'totalSupply' | 'remainingCommit'>,
): SupplyOpening => {
  const remaining = [...secrets.table.counts];
  const minted = new Array<bigint>(ITEM_TYPES).fill(0n);
  let salt = pureCircuits.resaltOf(secrets.table.salt);
  for (let idx = 0n; idx < ledger.openedCount; idx++) {
    const req = ledger.requests.lookup(idx);
    const lo = pureCircuits.rollOf(secrets.seed.seed, req.buyerSeed, idx);
    const roll = lo % (ledger.totalSupply - idx);
    const t = Number(pickItemType(roll, remaining));
    remaining[t] = (remaining[t] ?? 0n) - 1n;
    minted[t] = (minted[t] ?? 0n) + 1n;
    salt = pureCircuits.resaltOf(salt);
  }
  const supply: SupplyOpening = { remaining, minted, salt };
  if (toHex(pureCircuits.supplyCommitOf(supply)) !== toHex(ledger.remainingCommit)) {
    throw new Error('These publisher secrets do not match this drop');
  }
  return supply;
};

/** The private state with its supply cache brought up to date from the chain. */
export const withReplayedSupply = (
  ps: LootsealPrivateState,
  ledger: Pick<Ledger, 'requests' | 'openedCount' | 'totalSupply' | 'remainingCommit'>,
): LootsealPrivateState => {
  if (!ps.publisher) throw new Error('This wallet holds no publisher secrets for this drop');
  return { ...ps, publisher: { ...ps.publisher, supply: replaySupply(ps.publisher, ledger) } };
};
