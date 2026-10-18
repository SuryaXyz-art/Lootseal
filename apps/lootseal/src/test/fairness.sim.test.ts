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

// Fairness: the two properties Lootseal claims to players.
//  1. The drop delivers exactly the committed table: open every box and the
//     items handed out are the table, item for item.
//  2. Every box is ex-ante identical: because the draw order is random and
//     the remaining supply is hidden, the chance that box #k holds the
//     legendary is the same for every k (here tested with a chi-square test).

import { describe, expect, it } from 'vitest';
import { countsOf, demoCatalog, Drop, type CatalogEntry } from './fixtures.js';

describe('fairness', () => {
  it('a sold-out drop hands out exactly the committed table', () => {
    const d = new Drop().launch(); // 100 boxes, 16 item types
    for (let i = 0; i < 100; i++) d.buy(`buyer${i % 10}`);
    d.open(100);

    const received = new Array<bigint>(16).fill(0n);
    const serials = new Map<number, Set<bigint>>();
    for (let b = 0; b < 10; b++) {
      for (const op of Object.values(d.sync(`buyer${b}`).items)) {
        const t = Number(op.itemType);
        received[t] += 1n;
        if (!serials.has(t)) serials.set(t, new Set());
        serials.get(t)!.add(op.serial);
      }
    }
    expect(received).toEqual(countsOf(demoCatalog()));
    // Serials of each type are exactly 1..count, each handed out once.
    for (const [t, s] of serials) {
      expect([...s].sort((a, b) => Number(a - b))).toEqual(
        Array.from({ length: Number(countsOf(demoCatalog())[t]) }, (_, i) => BigInt(i + 1)),
      );
    }
    // The publisher's hidden state agrees, and the reveal verifies on chain.
    expect(d.state('publisher').publisher!.supply.remaining.every((x) => x === 0n)).toBe(true);
    d.as('publisher').call('finalReveal');
    d.as('auditor').call('verifyOdds');
    expect(d.ledger().oddsVerified).toBe(true);
  });

  it('every box position is equally likely to hold the legendary', () => {
    const BOXES = 5;
    const RUNS = 150;
    const catalog: CatalogEntry[] = Array.from({ length: 16 }, (_, i) => ({
      name: i === 0 ? 'Legend' : i === 1 ? 'Common' : '',
      tier: i === 0 ? 0 : 4,
      count: i === 0 ? 1 : i === 1 ? BOXES - 1 : 0,
    }));
    const hits = new Array<number>(BOXES).fill(0);
    for (let r = 0; r < RUNS; r++) {
      const d = new Drop(catalog).launch();
      for (let i = 0; i < BOXES; i++) d.buy('buyer');
      d.open(BOXES);
      // Item id k belongs to request k, so the legendary's id gives its position.
      const items = d.sync('buyer').items;
      expect(Object.keys(items).length).toBe(BOXES);
      const legendaryId = Object.keys(items).find((id) => items[id].itemType === 0n)!;
      hits[d.requestIndexOfItem(legendaryId)] += 1;
    }
    const expected = RUNS / BOXES;
    const chi2 = hits.reduce((a, h) => a + (h - expected) ** 2 / expected, 0);
    // df = 4; P(chi2 > 18.47) = 0.001 for a fair draw.
    expect(chi2, `legendary positions ${hits.join(',')}`).toBeLessThan(18.47);
    expect(hits.reduce((a, b) => a + b, 0)).toBe(RUNS);
  });
});
