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

// Privacy invariants (SPEC.md → Privacy invariants), checked against the
// decoded public ledger after every phase of a drop's life. Byte secrets are
// searched for anywhere in public state; numeric secrets (the hidden counts,
// item types and serials) are checked against every numeric public field.

import { describe, expect, it } from 'vitest';
import { assertNotInPublicState, collectPublicBytes } from '@midnight-ntwrk/example-sim';
import { pureCircuits, type Ledger } from '../../contract/managed/lootseal/contract/index.js';
import { fromHex, toHex, type LootsealPrivateState } from '../../contract/witnesses.js';
import { lootsealIdOf, parseLootsealId } from '../../contract/lib.js';
import { DAY, Drop, NOW } from './fixtures.js';

const le32 = (x: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

/** Every byte-level secret a participant holds, labelled for the error message. */
const secretsOf = (d: Drop, name: string, ps: LootsealPrivateState): Record<string, Uint8Array> => {
  const out: Record<string, Uint8Array> = {
    [`${name}.holderSecret`]: ps.holderSecret,
    [`${name}.holderEncSecret`]: le32(ps.holderEncSecret),
  };
  for (const [itemHex, op] of Object.entries(ps.items)) {
    out[`${name}.item(${itemHex.slice(0, 8)}).salt`] = op.salt;
    const delivery = d.ledger().deliveries.lookup(fromHex(itemHex));
    const shared = pureCircuits.sharedPoint(ps.holderEncSecret, delivery.ephemeral);
    out[`${name}.item(${itemHex.slice(0, 8)}).sharedSecret`] = le32(shared.x);
  }
  const p = ps.publisher;
  if (p) {
    out['publisher.secret'] = p.secret;
    out['publisher.encSecret'] = le32(p.encSecret);
    out['publisher.tableSalt'] = p.table.salt;
    out['publisher.supplySalt'] = p.supply.salt;
    out['publisher.masterSeed'] = p.seed.seed;
    out['publisher.seedSalt'] = p.seed.salt;
  }
  // An all-zero placeholder (the supply salt before commitTable) is not a secret.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.some((b) => b !== 0)));
};

/** All public numbers in the ledger's item-related fields, as strings. */
const publicNumbers = (l: Ledger): string[] => {
  const nums: string[] = [];
  for (const [, del] of l.deliveries) nums.push(del.cipher.toString(), del.version.toString());
  for (const [, b] of l.badges) nums.push(b.maxTier.toString());
  return nums;
};

const checkPhase = (d: Drop, phase: string, revealed = false) => {
  const l = d.ledger();
  for (const name of d.people.keys()) {
    const ps = d.sync(name);
    try {
      assertNotInPublicState(l, secretsOf(d, name, ps));
    } catch (e) {
      throw new Error(`[${phase}] ${(e as Error).message}`);
    }
    // The packed (type, serial) of an owned item never appears in clear.
    for (const op of Object.values(ps.items)) {
      const packed = pureCircuits.packOpening(op).toString();
      expect(publicNumbers(l), `[${phase}] item opening visible`).not.toContain(packed);
    }
  }
  if (!revealed) {
    // Until the final reveal, no per-type count is public anywhere.
    expect(l.revealedInitial.every((x) => x === 0n), `[${phase}] initial table leaked`).toBe(true);
    expect(l.revealedRemaining.every((x) => x === 0n), `[${phase}] remaining supply leaked`).toBe(true);
  }
};

describe('privacy invariants', () => {
  it('hold through launch, sales, opening, badges, transfers, the bazaar and the reveal', () => {
    const d = new Drop();
    checkPhase(d, 'deployed');
    d.launch();
    checkPhase(d, 'launched');

    for (const n of ['alice', 'bob', 'carol']) d.buy(n);
    checkPhase(d, 'requested');
    d.open(3);
    checkPhase(d, 'opened');

    const [aliceItem] = d.vault('alice');
    d.as('alice').call('proveRarityTier', fromHex(aliceItem), 4n, new Uint8Array(32));
    checkPhase(d, 'badge');

    const dave = parseLootsealId(lootsealIdOf(d.address, d.as('dave').state('dave')));
    d.as('alice').call('transferItem', fromHex(aliceItem), dave.ownerPk, dave.encKey);
    checkPhase(d, 'transferred');

    const [bobItem] = d.vault('bob');
    d.as('bob').call('listItem', fromHex(bobItem), 25n, 4n, d.refund.get('bob')!);
    d.as('carol').call('buyListing', fromHex(bobItem), d.refund.get('carol')!, BigInt(NOW));
    d.as('bob').call('settleListing', fromHex(bobItem));
    checkPhase(d, 'sold');

    d.time = NOW + 8 * DAY;
    d.as('publisher').call('finalReveal');
    checkPhase(d, 'revealed', true);
    // The master seed is never part of the reveal.
    assertNotInPublicState(d.ledger(), { masterSeed: d.state('publisher').publisher!.seed.seed });
  });

  it('a transfer leaves no link to the receiver on chain', () => {
    const d = new Drop().launch();
    d.buy('alice');
    d.open();
    const [item] = d.vault('alice');
    const bobPs = d.as('bob').state('bob');
    const bob = parseLootsealId(lootsealIdOf(d.address, bobPs));
    d.as('alice').call('transferItem', fromHex(item), bob.ownerPk, bob.encKey);
    // Neither bob's owner key nor his encryption key is written anywhere.
    assertNotInPublicState(d.ledger(), {
      'bob.ownerPk': bob.ownerPk,
      'bob.encKey.x': le32(bob.encKey.x),
      'bob.encKey.y': le32(bob.encKey.y),
    });
  });

  it('the public fields per item are only a commitment and a ciphertext', () => {
    const d = new Drop().launch();
    d.buy('alice');
    d.open();
    const labels = collectPublicBytes(d.ledger())
      .map((b) => b.label)
      .filter((l) => l.startsWith('items') || l.startsWith('deliveries'));
    expect(labels.sort()).toEqual(['deliveries[0].key', 'items[0].key', 'items[0].value']);
    expect(toHex(d.ledger().items.lookup(pureCircuits.itemIdOf(0n))).length).toBe(64);
  });
});
