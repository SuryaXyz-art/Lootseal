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

// Fulfiller queue: strict FIFO opening, stopping when the drop is not live,
// backoff on conflicts, no overlapping runs, and an accurate /health view.

import { describe, expect, it } from 'vitest';
import { createQueue, INITIAL_BACKOFF_MS, type DropView, type Health } from '../../fulfiller/queue.js';

const newHealth = (): Health => ({
  status: 'starting',
  network: 'test',
  drop: 'drop',
  opened: 0,
  requested: 0,
  pending: 0,
  lastOpenedAt: null,
  lastError: null,
  startedAt: new Date(0).toISOString(),
});

const silent = { info: () => {}, warn: () => {} };

/** An in-memory chain: opening box i succeeds only if i is the next unopened box. */
function fakeChain(requests: number, live = true) {
  const chain = { opened: 0n, requested: BigInt(requests), live, opens: [] as bigint[] };
  const read = async (): Promise<DropView> => ({
    live: chain.live,
    openedCount: chain.opened,
    requestCount: chain.requested,
  });
  const open = async (i: bigint) => {
    if (i !== chain.opened) throw new Error(`box ${i} is not next (next is ${chain.opened})`);
    chain.opens.push(i);
    chain.opened += 1n;
  };
  return { chain, read, open };
}

describe('fulfiller queue', () => {
  it('opens every pending box in order and reports health', async () => {
    const { chain, read, open } = fakeChain(5);
    const health = newHealth();
    const q = createQueue({ read, open, health, log: silent, now: () => new Date(1000) });
    await q.tick();
    expect(chain.opens).toEqual([0n, 1n, 2n, 3n, 4n]);
    expect(health).toMatchObject({ status: 'running', opened: 5, requested: 5, pending: 0, lastError: null });
    expect(health.lastOpenedAt).toBe(new Date(1000).toISOString());
  });

  it('does nothing when there is nothing to open', async () => {
    const { chain, read, open } = fakeChain(0);
    const health = newHealth();
    await createQueue({ read, open, health, log: silent }).tick();
    expect(chain.opens).toEqual([]);
    expect(health.status).toBe('running');
  });

  it('does not open boxes once the drop is no longer live', async () => {
    const { chain, read, open } = fakeChain(3, false);
    const health = newHealth();
    await createQueue({ read, open, health, log: silent }).tick();
    expect(chain.opens).toEqual([]);
    expect(health.pending).toBe(3);
  });

  it('picks up boxes bought after an earlier run', async () => {
    const { chain, read, open } = fakeChain(2);
    const q = createQueue({ read, open, health: newHealth(), log: silent });
    await q.tick();
    chain.requested += 3n;
    await q.tick();
    expect(chain.opens).toEqual([0n, 1n, 2n, 3n, 4n]);
  });

  it('on a conflict, re-reads and resumes from the chain order', async () => {
    const { chain, read, open } = fakeChain(4);
    // Another fulfiller opens box 0 between our read and our open.
    let raced = false;
    const racingOpen = async (i: bigint) => {
      if (!raced) {
        raced = true;
        chain.opened += 1n;
      }
      await open(i);
    };
    const retries: Array<() => void> = [];
    const health = newHealth();
    const q = createQueue({ read, open: racingOpen, health, log: silent, schedule: (fn) => retries.push(fn) });
    await q.tick();
    expect(health.lastError).toMatch(/not next/);
    expect(retries).toHaveLength(1);
    expect(q.backoffMs()).toBe(INITIAL_BACKOFF_MS);
    await q.tick();
    expect(chain.opens).toEqual([1n, 2n, 3n]);
    expect(chain.opened).toBe(4n);
    expect(health.lastError).toBeNull();
    expect(q.backoffMs()).toBe(0);
  });

  it('doubles the backoff on repeated failures, up to the cap', async () => {
    const { read } = fakeChain(1);
    const delays: number[] = [];
    const q = createQueue({
      read,
      open: async () => {
        throw new Error('node unreachable');
      },
      health: newHealth(),
      log: silent,
      schedule: (_fn, ms) => delays.push(ms),
      maxBackoffMs: 10_000,
    });
    for (let i = 0; i < 5; i++) await q.tick();
    expect(delays).toEqual([2_000, 4_000, 8_000, 10_000, 10_000]);
  });

  it('never runs two opens at once', async () => {
    const { chain, read } = fakeChain(3);
    let inFlight = 0;
    let maxInFlight = 0;
    const slowOpen = async (i: bigint) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      if (i !== chain.opened) throw new Error('out of order');
      chain.opens.push(i);
      chain.opened += 1n;
      inFlight--;
    };
    const q = createQueue({ read, open: slowOpen, health: newHealth(), log: silent });
    await Promise.all([q.tick(), q.tick(), q.tick()]);
    expect(maxInFlight).toBe(1);
    expect(chain.opens).toEqual([0n, 1n, 2n]);
  });
});
