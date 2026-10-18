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

// Staged deployment for contracts too large to deploy in one block.
//
// A Lootseal drop has 15 provable circuits. Deploying it writes every
// circuit's verifier key into the contract state at once (~40 KB of modelled
// writes against a 50 KB per-block limit), and the node never fits that
// transaction into a block. So the drop is deployed with the circuits needed
// to launch, and the remaining verifier keys are installed afterwards with
// signed contract-maintenance updates (VerifierKeyInsert), a few per
// transaction. The keys are the contract's own compiled keys: anyone can
// check them against the published build with verifierKeysEqual.
//
// Browser-safe: used by the Node harness, the fulfiller and the web app.
import { createUnprovenDeployTx, submitTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  ContractDeploy,
  ContractOperationVersionedVerifierKey,
  ContractState as LedgerContractState,
  Intent,
  MaintenanceUpdate,
  Transaction,
  VerifierKeyInsert,
  signData,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  ContractState,
  sampleSigningKey,
  type ContractAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { SucceedEntirely, type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

/** Circuits deployed with the contract: everything a publisher needs to launch and sell. */
export const DEPLOY_CIRCUITS = ['commitTable', 'commitSeed', 'requestBox', 'openBox'] as const;

/** How many verifier keys one maintenance transaction installs. */
export const INSTALL_BATCH = 4;

export type StagedProgress =
  | { step: 'deploying' }
  | { step: 'deployed'; address: ContractAddress }
  | { step: 'installing'; address: ContractAddress; done: number; total: number }
  | { step: 'installed'; address: ContractAddress };

const ttl = () => new Date(Date.now() + 60 * 60 * 1000);

type AnyProviders = MidnightProviders<any, any, any>;

export interface StagedDeployOptions<PS> {
  compiledContract: any;
  privateStateId: string;
  initialPrivateState: PS;
  args: unknown[];
}

/**
 * Deploys `compiledContract` with only DEPLOY_CIRCUITS, stores the private
 * state and maintenance signing key, then installs every other circuit.
 * Resumable: if it stops part-way, installMissingCircuits() finishes it.
 */
export async function deployStaged<PS>(
  providers: AnyProviders,
  options: StagedDeployOptions<PS>,
  onProgress: (p: StagedProgress) => void = () => {},
): Promise<{ address: ContractAddress }> {
  onProgress({ step: 'deploying' });
  const signingKey = sampleSigningKey();
  const data = await createUnprovenDeployTx(providers as any, {
    compiledContract: options.compiledContract,
    initialPrivateState: options.initialPrivateState,
    args: options.args,
    signingKey,
  } as any);
  const full = data.public.initialContractState as unknown as ContractState;

  const initial = new ContractState();
  initial.data = full.data;
  initial.maintenanceAuthority = full.maintenanceAuthority;
  for (const name of DEPLOY_CIRCUITS) {
    const op = full.operation(name);
    if (!op) throw new Error(`The compiled contract has no circuit '${name}'`);
    initial.setOperation(name, op);
  }
  const deploy = new ContractDeploy(LedgerContractState.deserialize(initial.serialize()));
  const address = deploy.address as ContractAddress;

  // Keep the secrets before anything is submitted, so a failed or abandoned
  // deploy never loses them.
  providers.privateStateProvider.setContractAddress(address);
  await providers.privateStateProvider.set(options.privateStateId, data.private.initialPrivateState as PS);
  await providers.privateStateProvider.setSigningKey(address, signingKey);

  const unprovenTx = Transaction.fromParts(getNetworkId(), undefined, undefined, Intent.new(ttl()).addDeploy(deploy));
  const result = await submitTx(providers as any, { unprovenTx: unprovenTx as any });
  if (result.status !== SucceedEntirely) throw new Error(`The deploy transaction failed (${result.status})`);
  onProgress({ step: 'deployed', address });

  const allIds = full.operations().map(opName);
  await installMissingCircuits(providers, address, allIds, full, onProgress);
  return { address };
}

/**
 * Installs every circuit in `allIds` the deployed contract does not have yet,
 * INSTALL_BATCH verifier keys per signed maintenance transaction. Keys come
 * from `compiled` (the contract's full initial state) when given, otherwise
 * from the zk config provider (the published build).
 */
export async function installMissingCircuits(
  providers: AnyProviders,
  address: ContractAddress,
  allIds: string[],
  compiled: ContractState | null = null,
  onProgress: (p: StagedProgress) => void = () => {},
): Promise<void> {
  const missing = await missingCircuits(providers, address, allIds);
  const total = allIds.length;
  let done = total - missing.length;
  onProgress({ step: 'installing', address, done, total });
  if (missing.length === 0) {
    onProgress({ step: 'installed', address });
    return;
  }
  const signingKey = await providers.privateStateProvider.getSigningKey(address);
  if (!signingKey) throw new Error('This browser does not hold the maintenance key for this drop');

  for (let i = 0; i < missing.length; i += INSTALL_BATCH) {
    const batch = missing.slice(i, i + INSTALL_BATCH);
    const state = await providers.publicDataProvider.queryContractState(address);
    if (!state) throw new Error(`No contract state found at ${address}`);
    const updates = [];
    for (const name of batch) {
      const vk = compiled?.operation(name)?.verifierKey ?? (await providers.zkConfigProvider.getVerifierKey(name));
      updates.push(new VerifierKeyInsert(name, new ContractOperationVersionedVerifierKey('v3', vk)));
    }
    const update = new MaintenanceUpdate(address, updates, state.maintenanceAuthority.counter);
    const signed = update.addSignature(0n, signData(signingKey, update.dataToSign));
    const unprovenTx = Transaction.fromParts(
      getNetworkId(),
      undefined,
      undefined,
      Intent.new(ttl()).addMaintenanceUpdate(signed),
    );
    const result = await submitTx(providers as any, { unprovenTx: unprovenTx as any });
    if (result.status !== SucceedEntirely) throw new Error(`Installing circuits failed (${result.status})`);
    done += batch.length;
    onProgress({ step: 'installing', address, done, total });
  }
  onProgress({ step: 'installed', address });
}

/** The compiled circuits the contract at `address` does not have yet. */
export async function missingCircuits(
  providers: Pick<AnyProviders, 'publicDataProvider'>,
  address: ContractAddress,
  allIds: string[],
): Promise<string[]> {
  const state = await providers.publicDataProvider.queryContractState(address);
  if (!state) throw new Error(`No contract state found at ${address}`);
  const present = new Set(state.operations().map(opName));
  return allIds.filter((id) => !present.has(id));
}

const opName = (o: string | Uint8Array): string => (typeof o === 'string' ? o : new TextDecoder().decode(o));
