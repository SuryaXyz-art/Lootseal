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

// The shared TypeScript layer (contract/lib.ts, contract/bundle.ts) against
// the real contract: supply replay, encrypted backups, Lootseal IDs.

import { describe, expect, it } from 'vitest';
import { expectRejects } from '@midnight-ntwrk/example-sim';
import { pureCircuits } from '../../contract/managed/lootseal/contract/index.js';
import { createLootsealPrivateState, createPublisherPrivateState, toHex } from '../../contract/witnesses.js';
import {
  decodeText32,
  encodeText32,
  lootsealIdOf,
  parseLootsealId,
  replaySupply,
  withReplayedSupply,
} from '../../contract/lib.js';
import { decodeState, decryptBundle, encodeState, encryptBundle, parseBundle } from '../../contract/bundle.js';
import { countsOf, demoCatalog, Drop } from './fixtures.js';

describe('replaySupply', () => {
  it('rebuilds the exact hidden supply from the secrets and the public request log', () => {
    const d = new Drop().launch();
    for (let i = 0; i < 25; i++) d.buy(`b${i % 5}`);
    d.open(25);
    const secrets = d.state('publisher').publisher!;
    const replayed = replaySupply(secrets, d.ledger());
    expect(replayed.remaining).toEqual(secrets.supply.remaining);
    expect(replayed.minted).toEqual(secrets.supply.minted);
    expect(toHex(pureCircuits.supplyCommitOf(replayed))).toBe(toHex(d.ledger().remainingCommit));
  });

  it('lets a second copy of the secrets with a stale cache keep opening boxes', () => {
    const d = new Drop().launch();
    const stale = d.state('publisher'); // the supply cache as of launch
    for (let i = 0; i < 6; i++) d.buy('alice');
    d.open(3);
    // Another machine with the launch-time state replays, then opens the rest.
    d.setState('publisher', withReplayedSupply(stale, d.ledger()));
    d.open(3);
    expect(d.ledger().openedCount).toBe(6n);
    expect(d.vault('alice').length).toBe(6);
  });

  it('rejects secrets that belong to another drop', () => {
    const d = new Drop().launch();
    d.buy('alice');
    d.open();
    const foreign = createPublisherPrivateState(countsOf(demoCatalog())).publisher!;
    expectRejects(() => replaySupply(foreign, d.ledger()), 'do not match this drop');
  });
});

describe('encrypted bundles', () => {
  it('round-trip the full private state, bigints and bytes included', async () => {
    const ps = createPublisherPrivateState(countsOf(demoCatalog()));
    expect(decodeState(encodeState(ps))).toEqual(ps);
    const bundle = await encryptBundle('ab'.repeat(32), ps, 'correct horse battery');
    expect(bundle.publisher).toBe(true);
    expect(JSON.stringify(bundle)).not.toContain(toHex(ps.publisher!.seed.seed));
    const back = await decryptBundle(parseBundle(JSON.stringify(bundle)), 'correct horse battery');
    expect(back).toEqual(ps);
  });

  it('refuse a wrong passphrase, short passphrases and foreign files', async () => {
    const ps = createLootsealPrivateState();
    const bundle = await encryptBundle('ab'.repeat(32), ps, 'correct horse battery');
    await expect(decryptBundle(bundle, 'wrong passphrase!!')).rejects.toThrow('Wrong passphrase');
    await expect(encryptBundle('ab'.repeat(32), ps, 'short')).rejects.toThrow('at least 12');
    expect(() => parseBundle('{"hello":1}')).toThrow('not a Lootseal backup');
    expect(() => parseBundle('not json')).toThrow('not a Lootseal backup');
  });
});

describe('text and ids', () => {
  it('encode names into Bytes<32> and back', () => {
    expect(decodeText32(encodeText32('Dragon Sigil'))).toBe('Dragon Sigil');
    expect(decodeText32(encodeText32('Драконья печать'))).toBe('Драконья печать');
    expect(() => encodeText32('x'.repeat(33))).toThrow('longer than 32 bytes');
  });

  it('format and parse Lootseal IDs, rejecting garbage', () => {
    const ps = createLootsealPrivateState();
    const id = lootsealIdOf('cd'.repeat(32), ps);
    const parsed = parseLootsealId(id);
    expect(parsed.encKey).toEqual(pureCircuits.encPublicKey(ps.holderEncSecret));
    expect(() => parseLootsealId('ls2:00:00:00')).toThrow('Not a Lootseal ID');
    expect(() => parseLootsealId('ls1:zz:00:00')).toThrow();
    expect(() => parseLootsealId('ls1:' + '00'.repeat(32) + ':xyz:00')).toThrow('encryption key');
  });
});
