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

// In-memory tests for the drop registry (contract/registry.compact).

import { describe, expect, it } from 'vitest';
import { Sim, expectRejects } from '@midnight-ntwrk/example-sim';
import { Contract, ledger } from '../../contract/managed/registry/contract/index.js';
import { pureCircuits } from '../../contract/managed/lootseal/contract/index.js';
import { createRegistryPrivateState, registryWitnesses } from '../../contract/registry-witnesses.js';
import { fromHex, randomBytes, toHex } from '../../contract/witnesses.js';
import { decodeText32, encodeText32 } from '../../contract/lib.js';
import { Drop, NOW } from './fixtures.js';

const deployRegistry = (secret: Uint8Array) => {
  const sim = Sim.deploy({
    contract: new Contract(registryWitnesses),
    ledger,
    privateState: createRegistryPrivateState(secret),
  });
  sim.time = NOW;
  return sim;
};

describe('registry', () => {
  it('lists a drop with the publisher key the drop itself stores', () => {
    const drop = new Drop();
    const secret = drop.state('publisher').publisher!.secret;
    const reg = deployRegistry(secret);
    reg.call('registerDrop', fromHex(drop.address), encodeText32('Genesis Relics'), BigInt(NOW));
    const l = reg.ledger();
    expect(l.dropCount).toBe(1n);
    const entry = l.drops.lookup(0n);
    expect(toHex(entry.dropAddress)).toBe(drop.address);
    expect(decodeText32(entry.title)).toBe('Genesis Relics');
    expect(entry.registeredAt).toBe(BigInt(NOW));
    // The app shows an entry only if this matches the drop's own publisherPk.
    expect(toHex(entry.publisherPk)).toBe(toHex(drop.ledger().publisherPk));
    expect(toHex(entry.publisherPk)).toBe(toHex(pureCircuits.publisherKey(secret)));
  });

  it('an impostor can add an entry, but it never matches the drop', () => {
    const drop = new Drop();
    const reg = deployRegistry(randomBytes(32));
    reg.call('registerDrop', fromHex(drop.address), encodeText32('Totally Legit'), BigInt(NOW));
    expect(toHex(reg.ledger().drops.lookup(0n).publisherPk)).not.toBe(toHex(drop.ledger().publisherPk));
  });

  it('refuses duplicates and bad clocks', () => {
    const drop = new Drop();
    const reg = deployRegistry(drop.state('publisher').publisher!.secret);
    expectRejects(() => reg.call('registerDrop', fromHex(drop.address), encodeText32('x'), BigInt(NOW + 3600)),
      'Your clock is too far from block time');
    expectRejects(() => reg.call('registerDrop', fromHex(drop.address), encodeText32('x'), 1n), 'Invalid timestamp');
    reg.call('registerDrop', fromHex(drop.address), encodeText32('x'), BigInt(NOW));
    expectRejects(() => reg.call('registerDrop', fromHex(drop.address), encodeText32('x'), BigInt(NOW)),
      'This drop is already registered');
  });
});
