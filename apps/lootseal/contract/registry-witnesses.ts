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

// Witnesses for registry.compact. The registrant proves knowledge of the
// drop's publisher secret, so the registry entry carries the same
// publisherPk the drop itself stores. Browser-safe.
import { type Ledger } from './managed/registry/contract/index.js';
import { type WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

export type RegistryPrivateState = {
  /** The publisher secret of the drop being registered. */
  registrantSecret: Uint8Array;
};

export const createRegistryPrivateState = (registrantSecret: Uint8Array): RegistryPrivateState => ({
  registrantSecret,
});

export const registryWitnesses = {
  registrantSecret: ({
    privateState,
  }: WitnessContext<Ledger, RegistryPrivateState>): [RegistryPrivateState, Uint8Array] => [
    privateState,
    privateState.registrantSecret,
  ],
};
