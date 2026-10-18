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

// In-memory tests: the compiled contract runs with compact-runtime, with no
// network and no proofs. Every circuit has a happy path here, and every
// reachable assert has a test that triggers it with its exact message.
// Privacy invariants live in privacy.sim.test.ts and the statistical
// fairness checks in fairness.sim.test.ts.

import { describe, expect, it } from 'vitest';
import { Sim, assertNotInPublicState, expectRejects } from '@midnight-ntwrk/example-sim';
import {
  Contract,
  DropState,
  ListingStatus,
  RequestStatus,
  ledger,
  pureCircuits,
} from '../../contract/managed/lootseal/contract/index.js';
import {
  createPublisherPrivateState,
  fromHex,
  randomBytes,
  toHex,
  witnesses,
  type LootsealPrivateState,
} from '../../contract/witnesses.js';
import {
  FIELD_MODULUS,
  decodeText32,
  lootsealIdOf,
  parseLootsealId,
  tierOdds,
  topShare,
} from '../../contract/lib.js';
import {
  BOND,
  DAY,
  Drop,
  NOW,
  PENALTY,
  PRICE,
  countsOf,
  demoCatalog,
  dropParams,
  tierTotalsOf,
} from './fixtures.js';

const ZERO32 = new Uint8Array(32);
const ctx = (s: string) => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(s));
  return b;
};

/** A launched drop where alice bought and received one item. */
const withAliceItem = () => {
  const d = new Drop().launch();
  d.buy('alice');
  d.open();
  const [itemHex] = d.vault('alice');
  return { d, itemHex, itemId: fromHex(itemHex) };
};

const tierOfItem = (d: Drop, itemHex: string, holder: string) =>
  Number(d.params.tiers[Number(d.state(holder).items[itemHex].itemType)]);

const deployWith = (params = dropParams(demoCatalog())) =>
  Sim.deploy({
    contract: new Contract(witnesses),
    ledger,
    privateState: createPublisherPrivateState(countsOf(demoCatalog())),
    args: [params],
  });

const withPublisherSecrets = (
  ps: LootsealPrivateState,
  patch: Partial<NonNullable<LootsealPrivateState['publisher']>>,
): LootsealPrivateState => ({ ...ps, publisher: { ...ps.publisher!, ...patch } });

// ─── constructor ────────────────────────────────────────────────────────────

describe('constructor', () => {
  it('publishes the catalog, odds and terms, and starts in SETUP', () => {
    const d = new Drop();
    const l = d.ledger();
    expect(decodeText32(l.title)).toBe('Genesis Relics');
    expect(l.catalogNames.map(decodeText32)).toEqual(demoCatalog().map((c) => c.name));
    expect(l.tierTotals).toEqual(tierTotalsOf(demoCatalog()));
    expect(l.totalSupply).toBe(100n);
    expect(l.price).toBe(PRICE);
    expect(l.state).toBe(DropState.SETUP);
    expect(toHex(l.publisherPk)).toBe(toHex(pureCircuits.publisherKey(d.state('publisher').publisher!.secret)));
    expect(l.publisherEncKey).toEqual(pureCircuits.encPublicKey(d.state('publisher').publisher!.encSecret));
    expect(tierOdds(l.tierTotals, l.totalSupply)).toEqual([2, 4, 12, 18, 64]);
    expect(topShare(1, l.tierTotals, l.totalSupply)).toBe(6);
  });

  it('rejects tier totals that do not add up to the supply', () => {
    expectRejects(() => deployWith(dropParams(demoCatalog(), { totalSupply: 99n })),
      'Tier totals must add up to the total supply');
  });

  it('rejects an empty drop', () => {
    expectRejects(() => deployWith(dropParams(demoCatalog(), { totalSupply: 0n, tierTotals: [0n, 0n, 0n, 0n, 0n] })),
      'Total supply must be positive');
  });

  it('rejects a catalog tier outside 0..4', () => {
    const p = dropParams(demoCatalog());
    p.tiers[3] = 5n;
    expectRejects(() => deployWith(p), 'Every catalog tier must be between 0 and 4');
  });

  it('rejects a penalty larger than the bond', () => {
    expectRejects(() => deployWith(dropParams(demoCatalog(), { penaltyPerBox: BOND + 1n })),
      'Penalty per box cannot exceed the bond');
  });
});

// ─── commitTable / commitSeed ───────────────────────────────────────────────

describe('commitTable', () => {
  it('commits the hidden table, takes the bond and moves to TABLE_COMMITTED', () => {
    const d = new Drop();
    d.as('publisher').call('commitTable');
    const l = d.ledger();
    const secrets = d.state('publisher').publisher!;
    expect(l.state).toBe(DropState.TABLE_COMMITTED);
    expect(toHex(l.tableCommit)).toBe(toHex(pureCircuits.tableCommitOf(secrets.table)));
    expect(toHex(l.remainingCommit)).toBe(toHex(pureCircuits.supplyCommitOf(secrets.supply)));
    expect(secrets.supply.remaining).toEqual(secrets.table.counts);
    expect(l.bondRemaining).toBe(BOND);
    expect(d.lastFlows().inputs).toBe(BOND);
  });

  it('rejects a hidden table whose tier sums differ from the advertised odds', () => {
    const counts = countsOf(demoCatalog());
    counts[0] += 1n; // one extra legendary…
    counts[15] -= 1n; // …taken from a common: same total, wrong odds
    const d = new Drop(demoCatalog(), dropParams(demoCatalog()), counts);
    expectRejects(() => d.as('publisher').call('commitTable'), 'Hidden table does not match the advertised odds');
  });

  it('rejects supply in an empty catalog slot', () => {
    const catalog = demoCatalog();
    const params = dropParams(catalog);
    params.names[15] = ZERO32; // slot 15 has no item, but the table gives it 10
    const d = new Drop(catalog, params);
    expectRejects(() => d.as('publisher').call('commitTable'), 'An empty catalog slot cannot have supply');
  });

  it('rejects anyone but the publisher', () => {
    const d = new Drop();
    expectRejects(() => d.as('mallory').call('commitTable'), 'This wallet holds no publisher secrets');
    d.setState('mallory', createPublisherPrivateState(countsOf(demoCatalog())));
    expectRejects(() => d.call('commitTable'), 'Only the publisher can do this');
  });

  it('cannot be committed twice', () => {
    const d = new Drop();
    d.as('publisher').call('commitTable');
    expectRejects(() => d.call('commitTable'), 'The table is already committed');
  });
});

describe('commitSeed', () => {
  it('commits the master seed and makes the drop LIVE', () => {
    const d = new Drop();
    d.as('publisher').call('commitTable');
    d.call('commitSeed');
    expect(d.ledger().state).toBe(DropState.LIVE);
    expect(toHex(d.ledger().seedCommit)).toBe(toHex(pureCircuits.seedCommitOf(d.state('publisher').publisher!.seed)));
  });

  it('requires the table first', () => {
    const d = new Drop();
    expectRejects(() => d.as('publisher').call('commitSeed'), 'Commit the table first');
  });

  it('rejects anyone but the publisher', () => {
    const d = new Drop();
    d.as('publisher').call('commitTable');
    d.as('mallory');
    d.setState('mallory', createPublisherPrivateState(countsOf(demoCatalog())));
    expectRejects(() => d.call('commitSeed'), 'Only the publisher can do this');
  });
});

// ─── requestBox ─────────────────────────────────────────────────────────────

describe('requestBox', () => {
  it('takes the price and queues a request with the buyer keys', () => {
    const d = new Drop().launch();
    const seed = randomBytes(32);
    d.buy('alice', seed);
    expect(d.lastFlows().inputs).toBe(PRICE);
    const r = d.ledger().requests.lookup(0n);
    expect(toHex(r.buyerSeed)).toBe(toHex(seed));
    expect(r.status).toBe(RequestStatus.PENDING);
    expect(r.requestedAt).toBe(BigInt(NOW));
    expect(r.buyerEncKey).toEqual(pureCircuits.encPublicKey(d.state('alice').holderEncSecret));
    expect(toHex(r.ownerPk)).toBe(toHex(pureCircuits.holderKey(fromHex(d.address), d.state('alice').holderSecret)));
    expect(d.ledger().requestCount).toBe(1n);
  });

  it('is refused before launch', () => {
    const d = new Drop();
    expectRejects(() => d.buy('alice'), 'This drop is not live');
  });

  it('is refused once sold out', () => {
    const catalog = demoCatalog().map((c, i) => ({ ...c, count: i < 2 ? 1 : 0 }));
    const d = new Drop(catalog).launch();
    d.buy('alice');
    d.buy('bob');
    expectRejects(() => d.buy('carol'), 'Sold out');
  });

  it('is refused after the sale ends', () => {
    const d = new Drop().launch();
    d.time = NOW + 7 * DAY;
    expectRejects(() => d.buy('alice'), 'The sale has ended');
  });

  it('rejects a clock far from block time, and nonsense timestamps', () => {
    const d = new Drop().launch();
    d.as('alice');
    expectRejects(() => d.call('requestBox', randomBytes(32), d.refund.get('alice')!, BigInt(NOW + 3600)),
      'Your clock is too far from block time');
    expectRejects(() => d.call('requestBox', randomBytes(32), d.refund.get('alice')!, 5n), 'Invalid timestamp');
  });
});

// ─── openBox ────────────────────────────────────────────────────────────────

describe('openBox', () => {
  it('draws from the hidden table, re-commits the supply and delivers the item encrypted', () => {
    const d = new Drop().launch();
    d.buy('alice');
    const before = d.ledger().remainingCommit;
    d.open();
    const l = d.ledger();
    expect(l.openedCount).toBe(1n);
    expect(l.requests.lookup(0n).status).toBe(RequestStatus.OPENED);
    expect(toHex(l.remainingCommit)).not.toBe(toHex(before));
    expect(l.publisherClaimable).toBe(PRICE);
    const itemId = pureCircuits.itemIdOf(0n);
    expect(l.items.member(itemId)).toBe(true);
    expect(l.deliveries.lookup(itemId).version).toBe(0n);

    const vault = d.vault('alice');
    expect(vault).toEqual([toHex(itemId)]);
    const op = d.state('alice').items[vault[0]];
    // The publisher's private supply moved by exactly that item.
    const sup = d.state('publisher').publisher!.supply;
    const counts = countsOf(demoCatalog());
    expect(sup.remaining[Number(op.itemType)]).toBe(counts[Number(op.itemType)] - 1n);
    expect(sup.minted[Number(op.itemType)]).toBe(1n);
    expect(op.serial).toBe(1n);
    expect(toHex(l.remainingCommit)).toBe(toHex(pureCircuits.supplyCommitOf(sup)));
  });

  it('opens strictly in request order and numbers serials per item type', () => {
    const catalog = demoCatalog().map((c, i) => ({ ...c, tier: 4, count: i === 15 ? 3 : 0 }));
    const d = new Drop(catalog).launch();
    d.buy('alice');
    d.buy('bob');
    d.buy('carol');
    d.open(3);
    expect(d.sync('alice').items[toHex(pureCircuits.itemIdOf(0n))].serial).toBe(1n);
    expect(d.sync('bob').items[toHex(pureCircuits.itemIdOf(1n))].serial).toBe(2n);
    expect(d.sync('carol').items[toHex(pureCircuits.itemIdOf(2n))].serial).toBe(3n);
  });

  it('is deterministic: the same committed seed and buyer seed always draw the same item', () => {
    const publisher = createPublisherPrivateState(countsOf(demoCatalog()));
    const params = dropParams(demoCatalog());
    const buyerSeed = randomBytes(32);
    const run = () => {
      const s = Sim.deploy({ contract: new Contract(witnesses), ledger, privateState: publisher, args: [params] });
      s.time = NOW;
      s.call('commitTable');
      s.call('commitSeed');
      s.call('requestBox', buyerSeed, { bytes: ZERO32 }, BigInt(NOW));
      s.call('openBox');
      return s.privateState.publisher!.supply.minted.join(',');
    };
    expect(run()).toBe(run());
  });

  it('refuses when nothing is waiting, before launch, and for non-publishers', () => {
    const d = new Drop();
    expectRejects(() => d.open(), 'This drop is not live');
    d.launch();
    expectRejects(() => d.open(), 'No boxes are waiting to be opened');
    d.buy('alice');
    d.as('mallory');
    d.setState('mallory', createPublisherPrivateState(countsOf(demoCatalog())));
    expectRejects(() => d.call('openBox'), 'Only the publisher can do this');
  });

  it('rejects a seed other than the committed one', () => {
    const d = new Drop().launch();
    d.buy('alice');
    const ps = d.state('publisher');
    d.setState('publisher', withPublisherSecrets(ps, { seed: { ...ps.publisher!.seed, seed: randomBytes(32) } }));
    expectRejects(() => d.open(), 'Seed does not match its commitment');
  });

  it('rejects a tampered supply (e.g. a publisher secretly removing legendaries)', () => {
    const d = new Drop().launch();
    d.buy('alice');
    const ps = d.state('publisher');
    const remaining = [...ps.publisher!.supply.remaining];
    remaining[0] = 0n;
    remaining[15] += 1n;
    d.setState('publisher', withPublisherSecrets(ps, { supply: { ...ps.publisher!.supply, remaining } }));
    expectRejects(() => d.open(), 'Supply does not match its commitment');
  });

  it('rejects a lying roll reduction', () => {
    const d = new Drop(demoCatalog(), dropParams(demoCatalog()), countsOf(demoCatalog()), {
      divMod64: ({ privateState }, a, dd) => [privateState, [a / dd, ((a % dd) + 1n) % dd]],
    }).launch();
    d.buy('alice');
    expectRejects(() => d.open(), 'Invalid roll reduction');
  });

  it('rejects a lying item pick (choosing another item than the roll gives)', () => {
    const d = new Drop(demoCatalog(), dropParams(demoCatalog()), countsOf(demoCatalog()), {
      // Item 0 covers roll 0 only, item 1 covers roll 1: answer the other one.
      pickType: ({ privateState }, roll) => [privateState, roll === 0n ? 1n : 0n],
    }).launch();
    d.buy('alice');
    expectRejects(() => d.open(), 'Invalid item pick');
  });

  it('rejects an out-of-range item type', () => {
    const d = new Drop(demoCatalog(), dropParams(demoCatalog()), countsOf(demoCatalog()), {
      pickType: ({ privateState }) => [privateState, 16n],
    }).launch();
    d.buy('alice');
    expectRejects(() => d.open(), 'Invalid item type');
  });

  it('rejects a wrong publisher encryption key', () => {
    const d = new Drop().launch();
    d.buy('alice');
    const ps = d.state('publisher');
    d.setState('publisher', withPublisherSecrets(ps, { encSecret: ps.publisher!.encSecret + 1n }));
    expectRejects(() => d.open(), 'Wrong publisher encryption key');
  });
});

// ─── claimRefund ────────────────────────────────────────────────────────────

describe('claimRefund', () => {
  it('refunds price + penalty to the buyer after the window and marks the drop DEFAULTED', () => {
    const d = new Drop().launch();
    d.buy('alice');
    d.time = NOW + DAY;
    d.as('anyone').call('claimRefund', 0n);
    const l = d.ledger();
    expect(l.requests.lookup(0n).status).toBe(RequestStatus.REFUNDED);
    expect(l.state).toBe(DropState.DEFAULTED);
    expect(l.bondRemaining).toBe(BOND - PENALTY);
    expect(l.refundedCount).toBe(1n);
    const flows = d.lastFlows();
    expect(flows.outputs).toBe(PRICE + PENALTY);
    expect([...flows.paidTo.values()]).toEqual([PRICE + PENALTY]);
    // A defaulted drop accepts no new boxes and opens nothing more.
    expectRejects(() => d.buy('bob'), 'This drop is not live');
    expectRejects(() => d.open(), 'This drop is not live');
  });

  it('caps the penalty at what is left of the bond', () => {
    const catalog = demoCatalog();
    const d = new Drop(catalog, dropParams(catalog, { bondAmount: 7n, penaltyPerBox: 5n })).launch();
    d.buy('alice');
    d.buy('bob');
    d.time = NOW + DAY;
    d.as('x').call('claimRefund', 0n);
    expect(d.lastFlows().outputs).toBe(PRICE + 5n);
    d.call('claimRefund', 1n);
    expect(d.lastFlows().outputs).toBe(PRICE + 2n);
    expect(d.ledger().bondRemaining).toBe(0n);
  });

  it('is refused while the window is open, for opened boxes, and for unknown ids', () => {
    const d = new Drop().launch();
    d.buy('alice');
    d.buy('bob');
    expectRejects(() => d.as('x').call('claimRefund', 0n), 'The fulfillment window is still open');
    d.open();
    d.time = NOW + DAY;
    expectRejects(() => d.as('x').call('claimRefund', 0n), 'This box is not waiting to be opened');
    expectRejects(() => d.call('claimRefund', 9n), 'Unknown request');
  });
});

// ─── proveRarityTier ────────────────────────────────────────────────────────

describe('proveRarityTier', () => {
  it('records a badge with only the proven bound, never the item', () => {
    const { d, itemHex, itemId } = withAliceItem();
    const tier = tierOfItem(d, itemHex, 'alice');
    d.as('alice').call('proveRarityTier', itemId, BigInt(tier), ctx('opensea'));
    const badgeId = pureCircuits.badgeIdOf(itemId, ctx('opensea'), 0n);
    const b = d.ledger().badges.lookup(badgeId);
    expect(b.maxTier).toBe(BigInt(tier));
    expect(toHex(b.itemId)).toBe(itemHex);
    expect(b.version).toBe(0n);
  });

  it('refuses to claim a rarer tier than the item has', () => {
    const catalog = demoCatalog().map((c, i) => ({ ...c, tier: 4, count: i === 0 ? 2 : 0 }));
    const d = new Drop(catalog).launch();
    d.buy('alice');
    d.open();
    const [itemHex] = d.vault('alice');
    expectRejects(() => d.as('alice').call('proveRarityTier', fromHex(itemHex), 3n, ZERO32), 'This item is not that rare');
  });

  it('refuses non-owners and unknown items', () => {
    const { d, itemHex, itemId } = withAliceItem();
    // Bob somehow learned the opening, but not alice's owner secret.
    d.as('bob');
    d.setState('bob', { ...d.state('bob'), items: { [itemHex]: d.state('alice').items[itemHex] } });
    expectRejects(() => d.call('proveRarityTier', itemId, 4n, ZERO32), 'You do not own this item');
    expectRejects(() => d.call('proveRarityTier', randomBytes(32), 4n, ZERO32), 'Unknown item');
  });
});

// ─── transferItem ───────────────────────────────────────────────────────────

describe('transferItem', () => {
  it('moves the item to the receiver, who can decrypt it; the sender loses it', () => {
    const { d, itemHex, itemId } = withAliceItem();
    const original = d.state('alice').items[itemHex];
    const bob = parseLootsealId(lootsealIdOf(d.address, d.as('bob').state('bob')));
    d.as('alice').call('transferItem', itemId, bob.ownerPk, bob.encKey);
    expect(d.vault('alice')).toEqual([]);
    expect(d.vault('bob')).toEqual([itemHex]);
    const received = d.state('bob').items[itemHex];
    expect(received.itemType).toBe(original.itemType);
    expect(received.serial).toBe(original.serial);
    expect(d.ledger().deliveries.lookup(itemId).version).toBe(1n);
    // Bob can now prove rarity; alice can no longer move it.
    d.as('bob').call('proveRarityTier', itemId, 4n, ZERO32);
    d.as('alice');
    d.setState('alice', { ...d.state('alice'), items: { [itemHex]: original } });
    expectRejects(() => d.call('transferItem', itemId, bob.ownerPk, bob.encKey), 'You do not own this item');
  });

  it('a third party scanning the drop decrypts nothing', () => {
    const { d } = withAliceItem();
    d.as('eve');
    expect(d.vault('eve')).toEqual([]);
  });

  it('is blocked while the item has a pending bazaar sale', () => {
    const { d, itemId } = withAliceItem();
    d.as('alice').call('listItem', itemId, 50n, 4n, d.refund.get('alice')!);
    d.as('bob').call('buyListing', itemId, d.refund.get('bob')!, BigInt(NOW));
    const carol = parseLootsealId(lootsealIdOf(d.address, d.as('carol').state('carol')));
    expectRejects(() => d.as('alice').call('transferItem', itemId, carol.ownerPk, carol.encKey),
      'This item has a pending bazaar sale');
  });
});

// ─── Bazaar ─────────────────────────────────────────────────────────────────

describe('bazaar', () => {
  it('sells an item with a proven rarity bound through escrow', () => {
    const { d, itemHex, itemId } = withAliceItem();
    const tier = tierOfItem(d, itemHex, 'alice');
    d.as('alice').call('listItem', itemId, 50n, BigInt(tier), d.refund.get('alice')!);
    let l = d.ledger().listings.lookup(itemId);
    expect(l.status).toBe(ListingStatus.OPEN);
    expect(l.maxTier).toBe(BigInt(tier));

    d.as('bob').call('buyListing', itemId, d.refund.get('bob')!, BigInt(NOW));
    expect(d.lastFlows().inputs).toBe(50n);
    l = d.ledger().listings.lookup(itemId);
    expect(l.status).toBe(ListingStatus.PENDING);
    expect(l.deadline).toBe(BigInt(NOW + DAY));

    d.as('alice').call('settleListing', itemId);
    expect(d.lastFlows().outputs).toBe(50n);
    expect(d.ledger().listings.lookup(itemId).status).toBe(ListingStatus.SOLD);
    expect(d.vault('bob')).toEqual([itemHex]);
    expect(d.vault('alice')).toEqual([]);
  });

  it('refunds the buyer if the seller does not deliver in time', () => {
    const { d, itemId } = withAliceItem();
    d.as('alice').call('listItem', itemId, 50n, 4n, d.refund.get('alice')!);
    d.as('bob').call('buyListing', itemId, d.refund.get('bob')!, BigInt(NOW));
    expectRejects(() => d.as('x').call('refundListing', itemId), 'The seller still has time to deliver');
    d.time = NOW + DAY;
    d.call('refundListing', itemId);
    expect(d.lastFlows().outputs).toBe(50n);
    expect(d.ledger().listings.lookup(itemId).status).toBe(ListingStatus.CANCELLED);
    expect(d.vault('alice').length).toBe(1);
  });

  it('lets the seller cancel an open listing and relist', () => {
    const { d, itemId } = withAliceItem();
    d.as('alice').call('listItem', itemId, 50n, 4n, d.refund.get('alice')!);
    expectRejects(() => d.call('listItem', itemId, 60n, 4n, d.refund.get('alice')!), 'This item is already listed');
    d.call('cancelListing', itemId);
    expect(d.ledger().listings.lookup(itemId).status).toBe(ListingStatus.CANCELLED);
    expectRejects(() => d.call('cancelListing', itemId), 'Only an open listing can be cancelled');
    d.call('listItem', itemId, 60n, 4n, d.refund.get('alice')!);
    expect(d.ledger().listings.lookup(itemId).price).toBe(60n);
  });

  it('marks a listing stale once the item has moved', () => {
    const { d, itemId } = withAliceItem();
    d.as('alice').call('listItem', itemId, 50n, 4n, d.refund.get('alice')!);
    const carol = parseLootsealId(lootsealIdOf(d.address, d.as('carol').state('carol')));
    d.as('alice').call('transferItem', itemId, carol.ownerPk, carol.encKey);
    expectRejects(() => d.as('bob').call('buyListing', itemId, d.refund.get('bob')!, BigInt(NOW)), 'This listing is stale');
  });

  it('guards every bazaar step', () => {
    const { d, itemId } = withAliceItem();
    expectRejects(() => d.as('bob').call('buyListing', itemId, d.refund.get('bob')!, BigInt(NOW)), 'This item is not listed');
    expectRejects(() => d.call('settleListing', itemId), 'This item is not listed');
    expectRejects(() => d.call('cancelListing', itemId), 'This item is not listed');
    expectRejects(() => d.call('refundListing', itemId), 'This item is not listed');
    expectRejects(() => d.as('alice').call('listItem', itemId, 0n, 4n, d.refund.get('alice')!), 'Price must be positive');
    d.call('listItem', itemId, 50n, 4n, d.refund.get('alice')!);
    expectRejects(() => d.call('settleListing', itemId), 'This listing has no buyer waiting');
    expectRejects(() => d.call('refundListing', itemId), 'This listing has no buyer waiting');
    expectRejects(() => d.as('bob').call('cancelListing', itemId), 'This item is not in your vault');
    expectRejects(() => d.call('buyListing', itemId, d.refund.get('bob')!, BigInt(NOW + 3600)),
      'Your clock is too far from block time');
    d.call('buyListing', itemId, d.refund.get('bob')!, BigInt(NOW));
    expectRejects(() => d.as('carol').call('buyListing', itemId, d.refund.get('carol')!, BigInt(NOW)),
      'This listing is not open');
    // Knowing the opening is not enough: only the owner key can settle.
    d.as('mallory');
    d.setState('mallory', { ...d.state('mallory'), items: d.state('alice').items });
    expectRejects(() => d.call('settleListing', itemId), 'You do not own this item');
  });
});

// ─── Proceeds, final reveal, verifyOdds ─────────────────────────────────────

describe('claimProceeds', () => {
  it('pays the publisher for opened boxes only', () => {
    const d = new Drop().launch();
    d.buy('alice');
    d.buy('bob');
    d.open();
    d.as('publisher').call('claimProceeds');
    expect(d.lastFlows().outputs).toBe(PRICE);
    expect(d.ledger().publisherClaimable).toBe(0n);
    expectRejects(() => d.call('claimProceeds'), 'Nothing to claim');
    d.as('mallory');
    d.setState('mallory', createPublisherPrivateState(countsOf(demoCatalog())));
    expectRejects(() => d.call('claimProceeds'), 'Only the publisher can do this');
  });
});

describe('finalReveal and verifyOdds', () => {
  const soldOutDrop = () => {
    const catalog = demoCatalog().map((c, i) => ({ ...c, count: i < 4 ? 1 : 0 }));
    const d = new Drop(catalog).launch();
    for (const n of ['a', 'b', 'c', 'd']) d.buy(n);
    d.open(4);
    return d;
  };

  it('reveals the table and remainder, returns the bond, and lets anyone verify the odds', () => {
    const d = soldOutDrop();
    d.as('publisher').call('finalReveal');
    let l = d.ledger();
    expect(l.state).toBe(DropState.REVEALED);
    expect(l.revealedInitial).toEqual(countsOf(d.catalog));
    expect(l.revealedRemaining.every((x) => x === 0n)).toBe(true);
    expect(d.lastFlows().outputs).toBe(BOND);
    expect(l.bondRemaining).toBe(0n);
    d.as('auditor').call('verifyOdds');
    l = d.ledger();
    expect(l.oddsVerified).toBe(true);
  });

  it('can reveal after the sale ends with unsold supply', () => {
    const d = new Drop().launch();
    d.buy('alice');
    d.open();
    d.time = NOW + 7 * DAY;
    d.as('publisher').call('finalReveal');
    const l = d.ledger();
    const opened = l.revealedInitial.reduce((a, x, i) => a + (x - l.revealedRemaining[i]), 0n);
    expect(opened).toBe(1n);
    d.call('verifyOdds');
    expect(d.ledger().oddsVerified).toBe(true);
  });

  it('is refused while the sale runs, with unopened boxes, with a wrong opening, and by others', () => {
    const d = new Drop().launch();
    d.buy('alice');
    expectRejects(() => d.as('publisher').call('finalReveal'), 'The sale is still running');
    d.time = NOW + 7 * DAY;
    expectRejects(() => d.call('finalReveal'), 'Open every requested box first');
    d.open();
    const ps = d.state('publisher');
    d.setState('publisher', withPublisherSecrets(ps, { table: { ...ps.publisher!.table, salt: randomBytes(32) } }));
    expectRejects(() => d.call('finalReveal'), 'Table does not match its commitment');
    d.setState('publisher', withPublisherSecrets(ps, { supply: { ...ps.publisher!.supply, salt: randomBytes(32) } }));
    expectRejects(() => d.call('finalReveal'), 'Supply does not match its commitment');
    d.as('mallory');
    d.setState('mallory', createPublisherPrivateState(countsOf(demoCatalog())));
    expectRejects(() => d.call('finalReveal'), 'Only the publisher can do this');
  });

  it('is refused for drops that are not live', () => {
    const d = new Drop();
    expectRejects(() => d.as('publisher').call('finalReveal'), 'Only a live drop can be revealed');
    const s = soldOutDrop();
    s.as('publisher').call('finalReveal');
    expectRejects(() => s.call('finalReveal'), 'Only a live drop can be revealed');
  });

  it('verifyOdds needs a revealed table', () => {
    const d = new Drop().launch();
    expectRejects(() => d.as('x').call('verifyOdds'), 'The table has not been revealed yet');
  });
});

// ─── Pure circuits shared with the app ──────────────────────────────────────

describe('pure circuits', () => {
  it('agree on a Diffie-Hellman shared point over Jubjub', () => {
    const a = 123456789n;
    const b = 987654321n;
    const A = pureCircuits.encPublicKey(a);
    const B = pureCircuits.encPublicKey(b);
    expect(pureCircuits.sharedPoint(a, B)).toEqual(pureCircuits.sharedPoint(b, A));
    expect(pureCircuits.sharedPoint(a, B)).not.toEqual(pureCircuits.sharedPoint(a + 1n, B));
  });

  it('pack type and serial into one field element', () => {
    expect(pureCircuits.packOpening({ itemType: 3n, serial: 7n, salt: ZERO32 })).toBe(3n * 4294967296n + 7n);
  });

  it('rebuild an item commitment from a delivery (what the vault does)', () => {
    const { d, itemHex, itemId } = withAliceItem();
    const alice = d.state('alice');
    const delivery = d.ledger().deliveries.lookup(itemId);
    const shared = pureCircuits.sharedPoint(alice.holderEncSecret, delivery.ephemeral);
    const mask = pureCircuits.deliveryMask(shared, itemId, delivery.version);
    const op = alice.items[itemHex];
    expect(op.salt).toEqual(pureCircuits.itemSalt(shared, itemId, delivery.version));
    expect((pureCircuits.packOpening(op) + mask) % FIELD_MODULUS).toBe(delivery.cipher);
    const ownerPk = pureCircuits.holderKey(fromHex(d.address), alice.holderSecret);
    expect(pureCircuits.itemCommit(op, ownerPk)).toEqual(d.ledger().items.lookup(itemId));
  });

  it('give every request its own item id', () => {
    const ids = new Set(Array.from({ length: 50 }, (_, i) => toHex(pureCircuits.itemIdOf(BigInt(i)))));
    expect(ids.size).toBe(50);
  });
});

// ─── Privacy invariants (one entry per SPEC.md line) ───────────────────────
// The phase-by-phase version, plus the numeric checks, is privacy.sim.test.ts.

const le32 = (x: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

describe('privacy', () => {
  it('keeps secrets out of public state', () => {
    const { d, itemHex, itemId } = withAliceItem();
    d.as('alice').call('proveRarityTier', itemId, 4n, ZERO32);
    const alice = d.state('alice');
    const p = d.state('publisher').publisher!;
    const shared = pureCircuits.sharedPoint(alice.holderEncSecret, d.ledger().deliveries.lookup(itemId).ephemeral);
    // Gift the item to bob, then check bob's keys never land on chain either.
    const bobPs = d.as('bob').state('bob');
    const bob = parseLootsealId(lootsealIdOf(d.address, bobPs));
    const opening = alice.items[itemHex];
    d.as('alice').call('transferItem', itemId, bob.ownerPk, bob.encKey);
    assertNotInPublicState(d.ledger(), {
      publisherMasterSeed: p.seed.seed,
      publisherSeedSalt: p.seed.salt,
      publisherTableSalt: p.table.salt,
      publisherSupplySalt: p.supply.salt,
      publisherSecret: p.secret,
      publisherEncSecret: le32(p.encSecret),
      aliceHolderSecret: alice.holderSecret,
      aliceHolderEncSecret: le32(alice.holderEncSecret),
      aliceItemSalt: alice.items[itemHex].salt,
      aliceItemSharedSecret: le32(shared.x),
      aliceItemOpening: le32(pureCircuits.packOpening(opening)),
      bobOwnerPk: bob.ownerPk,
      bobEncKeyX: le32(bob.encKey.x),
      bobEncKeyY: le32(bob.encKey.y),
    });
  });
});
