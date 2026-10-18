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

// Shared fixtures for the in-memory suites: a demo catalog, drop parameters,
// and a small wrapper that runs one Sim with several participants, each with
// their own private state and wallet.
import { Sim } from '@midnight-ntwrk/example-sim';
import {
  Contract,
  ledger,
  pureCircuits,
  type DropParams,
  type Ledger,
} from '../../contract/managed/lootseal/contract/index.js';
import {
  createLootsealPrivateState,
  createPublisherPrivateState,
  randomBytes,
  toHex,
  witnesses,
  type LootsealPrivateState,
} from '../../contract/witnesses.js';
import { encodeText32, syncVault } from '../../contract/lib.js';

export const NOW = 1_800_000_000; // a fixed block time (seconds)
export const DAY = 86_400;

export type CatalogEntry = { name: string; tier: number; count: number };

/** 16 named items over the five tiers: 2 / 4 / 12 / 18 / 64 of 100 per scale unit. */
export const demoCatalog = (scale = 1): CatalogEntry[] => [
  { name: 'Dragon Sigil', tier: 0, count: 1 * scale },
  { name: 'Phoenix Crown', tier: 0, count: 1 * scale },
  { name: 'Void Lantern', tier: 1, count: 2 * scale },
  { name: 'Starforged Blade', tier: 1, count: 2 * scale },
  { name: 'Moonlit Aegis', tier: 2, count: 4 * scale },
  { name: 'Tidecaller Horn', tier: 2, count: 4 * scale },
  { name: 'Ember Charm', tier: 2, count: 4 * scale },
  { name: 'Frost Rune', tier: 3, count: 6 * scale },
  { name: 'Thorn Bracer', tier: 3, count: 6 * scale },
  { name: 'Storm Feather', tier: 3, count: 6 * scale },
  { name: 'Copper Key', tier: 4, count: 11 * scale },
  { name: 'Oak Totem', tier: 4, count: 11 * scale },
  { name: 'River Pebble', tier: 4, count: 11 * scale },
  { name: 'Ash Token', tier: 4, count: 11 * scale },
  { name: 'Moss Ring', tier: 4, count: 10 * scale },
  { name: 'Clay Idol', tier: 4, count: 10 * scale },
];

export const countsOf = (catalog: CatalogEntry[]): bigint[] => catalog.map((c) => BigInt(c.count));

export const tierTotalsOf = (catalog: CatalogEntry[]): bigint[] => {
  const t = [0n, 0n, 0n, 0n, 0n];
  for (const c of catalog) t[c.tier] += BigInt(c.count);
  return t;
};

export const userAddress = () => ({ bytes: randomBytes(32) });

export const PRICE = 10n;
export const BOND = 1_000n;
export const PENALTY = 5n;

export const dropParams = (catalog: CatalogEntry[], overrides: Partial<DropParams> = {}): DropParams => {
  const totals = tierTotalsOf(catalog);
  return {
    title: encodeText32('Genesis Relics'),
    names: catalog.map((c) => encodeText32(c.name)),
    tiers: catalog.map((c) => BigInt(c.tier)),
    tierTotals: totals,
    totalSupply: totals.reduce((a, b) => a + b, 0n),
    price: PRICE,
    bondAmount: BOND,
    penaltyPerBox: PENALTY,
    saleEnd: BigInt(NOW + 7 * DAY),
    fulfillWindow: BigInt(DAY),
    settleWindow: BigInt(DAY),
    payout: userAddress(),
    ...overrides,
  };
};

type DropSim = Sim<Contract<LootsealPrivateState>, LootsealPrivateState, Ledger>;

/**
 * One drop with named participants. `as(name)` makes the next calls use that
 * participant's private state (and wallet key); state changes are written
 * back to them after each call.
 */
export class Drop {
  readonly sim: DropSim;
  readonly people = new Map<string, LootsealPrivateState>();
  readonly wallets = new Map<string, string>();
  readonly refund = new Map<string, { bytes: Uint8Array }>();
  private current = 'publisher';

  constructor(
    readonly catalog: CatalogEntry[] = demoCatalog(),
    readonly params: DropParams = dropParams(catalog),
    publisherCounts: bigint[] = countsOf(catalog),
    witnessOverrides: Partial<typeof witnesses> = {},
  ) {
    const publisher = createPublisherPrivateState(publisherCounts);
    this.people.set('publisher', publisher);
    this.wallets.set('publisher', toHex(randomBytes(32)));
    this.sim = Sim.deploy({
      contract: new Contract({ ...witnesses, ...witnessOverrides }),
      ledger,
      privateState: publisher,
      args: [params],
      coinPublicKey: this.wallets.get('publisher'),
    });
    this.sim.time = NOW;
  }

  get address(): string {
    return this.sim.address;
  }

  get time(): number {
    return this.sim.time ?? NOW;
  }

  set time(t: number) {
    this.sim.time = t;
  }

  ledger(): Ledger {
    return this.sim.ledger();
  }

  state(name: string): LootsealPrivateState {
    const ps = this.people.get(name);
    if (!ps) throw new Error(`unknown participant ${name}`);
    return ps;
  }

  /** Switches to participant `name` (created on first use). */
  as(name: string): this {
    if (!this.people.has(name)) {
      this.people.set(name, createLootsealPrivateState());
      this.wallets.set(name, toHex(randomBytes(32)));
      this.refund.set(name, userAddress());
    }
    this.people.set(this.current, this.sim.privateState);
    this.current = name;
    this.sim.privateState = this.state(name);
    this.sim.as(this.wallets.get(name)!);
    return this;
  }

  /** Runs a circuit as the current participant and keeps their new private state. */
  call: DropSim['call'] = (circuit, ...args) => {
    const out = this.sim.call(circuit, ...args);
    this.people.set(this.current, this.sim.privateState);
    return out;
  };

  /** The participant's private state after re-scanning the ledger for their items. */
  sync(name: string): LootsealPrivateState {
    if (name === this.current) this.people.set(name, this.sim.privateState);
    const next = syncVault(this.address, this.state(name), this.ledger());
    this.people.set(name, next);
    if (name === this.current) this.sim.privateState = next;
    return next;
  }

  launch(): this {
    this.as('publisher');
    this.call('commitTable');
    this.call('commitSeed');
    return this;
  }

  buy(name: string, seed: Uint8Array = randomBytes(32)): bigint {
    this.as(name);
    const idx = this.ledger().requestCount;
    this.call('requestBox', seed, this.refund.get(name)!, BigInt(this.time));
    return idx;
  }

  open(times = 1): void {
    this.as('publisher');
    for (let i = 0; i < times; i++) this.call('openBox');
  }

  /** Replaces a participant's private state (e.g. to simulate tampering). */
  setState(name: string, ps: LootsealPrivateState): void {
    this.people.set(name, ps);
    if (name === this.current) this.sim.privateState = ps;
  }

  /** NIGHT the last call took in (receiveUnshielded) and paid out (sendUnshielded). */
  lastFlows(): { inputs: bigint; outputs: bigint; paidTo: Map<string, bigint> } {
    const effects = this.sim.lastContext!.currentQueryContext.effects;
    const sum = (m: Map<unknown, bigint>) => [...m.values()].reduce((a, b) => a + b, 0n);
    const paidTo = new Map<string, bigint>();
    for (const [[, addr], v] of effects.claimedUnshieldedSpends) {
      const key = addr.tag === 'user' ? addr.address : String(addr.address);
      paidTo.set(key, (paidTo.get(key) ?? 0n) + v);
    }
    return { inputs: sum(effects.unshieldedInputs), outputs: sum(effects.unshieldedOutputs), paidTo };
  }

  /** The request index that produced an item (item ids are itemIdOf(index)). */
  requestIndexOfItem(itemHex: string): number {
    const n = Number(this.ledger().requestCount);
    for (let k = 0; k < n; k++) if (toHex(pureCircuits.itemIdOf(BigInt(k))) === itemHex) return k;
    throw new Error(`item ${itemHex} was not produced by any request`);
  }

  /** Item ids (hex) the participant owns after syncing. */
  vault(name: string): string[] {
    return Object.keys(this.sync(name).items);
  }
}
