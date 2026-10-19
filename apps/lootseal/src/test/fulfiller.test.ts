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

// Devnet integration of the operational pieces, run as real processes:
//   1. `yarn deploy` deploys the registry and Genesis Relics, launches the
//      drop and writes deployments/local.json plus an encrypted publisher
//      bundle under .secrets/local/.
//   2. The fulfiller starts from that bundle with its own wallet (Bob).
//   3. A holder (Alice, free once the deploy is done; the fulfiller pays
//      its fees from Bob) buys boxes; the fulfiller opens them unattended; the holder
//      decrypts its items; /health reports the drop's progress.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { encodeUserAddress, type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { LOCAL_SEEDS, resolveWallet } from '@midnight-ntwrk/example-fast-sync';
import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type LootsealProviders } from '../providers.js';
import { CompiledLootsealContract, ledger, zkConfigPath, DropState } from '../../contract/index.js';
import { createLootsealPrivateState, randomBytes, type LootsealPrivateState } from '../../contract/witnesses.js';
import { syncVault } from '../../contract/lib.js';

// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const appDir = path.resolve(new URL(import.meta.url).pathname, '../../..');
const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info', transport: { target: 'pino-pretty' } });
const HEALTH_PORT = 8799;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(network !== 'local')('Deploy script + fulfiller (local devnet)', () => {
  let dropAddress: ContractAddress;
  let fulfiller: ChildProcess | null = null;
  let fulfillerLog = '';
  let wallet: MidnightWalletProvider;
  let providers: LootsealProviders;

  const queryDrop = async () => {
    const state = await providers.publicDataProvider.queryContractState(dropAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  };

  beforeAll(async () => {
    setNetworkId(getConfig().networkId);
  });

  afterAll(async () => {
    fulfiller?.kill('SIGTERM');
    if (wallet) await wallet.stop();
  });

  it('yarn deploy launches Genesis Relics and records it', () => {
    const run = spawnSync('npx', ['vite-node', 'scripts/deploy.ts'], {
      cwd: appDir,
      env: { ...process.env, MIDNIGHT_NETWORK: 'local', BUNDLE_PASSPHRASE: 'devnet fulfiller passphrase' },
      encoding: 'utf8',
      timeout: 15 * 60_000,
    });
    if (run.status !== 0) logger.error(`${run.stdout}\n${run.stderr}`);
    expect(run.status).toBe(0);
    const record = JSON.parse(readFileSync(path.join(appDir, 'deployments', 'local.json'), 'utf8')) as {
      registryAddress: string;
      featuredDrops: string[];
      drops: { totalSupply: number; tierTotals: number[]; state: number }[];
    };
    expect(record.registryAddress).toMatch(/^[0-9a-f]{64}$/);
    expect(record.drops[0]?.totalSupply).toBe(1000);
    expect(record.drops[0]?.tierTotals).toEqual([10, 40, 150, 300, 500]);
    expect(record.drops[0]?.state).toBe(DropState.LIVE);
    dropAddress = record.featuredDrops[0] as ContractAddress;
  });

  it('the fulfiller starts from the encrypted bundle and reports health', async () => {
    const secretsDir = path.join(appDir, '.secrets', 'local');
    const bundle = readdirSync(secretsDir).find((f) => f.startsWith(`publisher-${dropAddress.slice(0, 8)}`) && f.endsWith('.json'));
    expect(bundle).toBeDefined();
    expect(existsSync(path.join(secretsDir, `${bundle}.passphrase`))).toBe(false); // passphrase was supplied, not generated
    fulfiller = spawn('npx', ['vite-node', 'fulfiller/main.ts'], {
      cwd: appDir,
      env: {
        ...process.env,
        MIDNIGHT_NETWORK: 'local',
        DROP_ADDRESS: dropAddress,
        BUNDLE_PATH: path.join(secretsDir, bundle!),
        BUNDLE_PASSPHRASE: 'devnet fulfiller passphrase',
        FULFILLER_SEED: LOCAL_SEEDS.BOB,
        PORT: String(HEALTH_PORT),
        POLL_MS: '5000',
      },
    });
    fulfiller.stdout?.on('data', (d) => (fulfillerLog += String(d)));
    fulfiller.stderr?.on('data', (d) => (fulfillerLog += String(d)));
    // Wait for the health endpoint to say it is running (wallet sync + DUST first).
    const deadline = Date.now() + 10 * 60_000;
    let health: { status: string; drop: string } | null = null;
    while (Date.now() < deadline) {
      health = await fetch(`http://127.0.0.1:${HEALTH_PORT}/health`)
        .then((r) => r.json() as Promise<{ status: string; drop: string }>)
        .catch(() => null);
      if (health?.status === 'running') break;
      if (fulfiller.exitCode !== null) break;
      await sleep(3_000);
    }
    if (health?.status !== 'running') logger.error(fulfillerLog.slice(-4000));
    expect(health?.status).toBe('running');
    expect(health?.drop).toBe(dropAddress);
  });

  it('buyers get their boxes opened automatically and decrypt their items', async () => {
    const config = getConfig();
    const env: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };
    wallet = await MidnightWalletProvider.build(logger, env, resolveWallet('local').secret);
    await wallet.start();
    await syncWallet(logger, wallet.wallet, 10 * 60_000);
    providers = buildProviders(wallet, zkConfigPath, config);
    providers.privateStateProvider.setContractAddress(dropAddress);
    await providers.privateStateProvider.set('buyer', createLootsealPrivateState());
    const refundTo = { bytes: encodeUserAddress(wallet.unshieldedKeystore.getAddress()) };

    for (let i = 0; i < 2; i++) {
      await (submitCallTx as any)(providers, {
        compiledContract: CompiledLootsealContract,
        contractAddress: dropAddress,
        privateStateId: 'buyer',
        circuitId: 'requestBox',
        args: [randomBytes(32), refundTo, BigInt(Math.floor(Date.now() / 1000))],
      });
    }
    expect((await queryDrop()).requestCount).toBe(2n);

    // Nobody calls openBox here: the fulfiller must do it.
    const deadline = Date.now() + 10 * 60_000;
    let drop = await queryDrop();
    while (drop.openedCount < 2n && Date.now() < deadline) {
      await sleep(5_000);
      drop = await queryDrop();
    }
    if (drop.openedCount < 2n) console.error(fulfillerLog.slice(-4000));
    expect(drop.openedCount).toBe(2n);

    providers.privateStateProvider.setContractAddress(dropAddress);
    const ps = (await providers.privateStateProvider.get('buyer')) as LootsealPrivateState;
    const synced = syncVault(dropAddress, ps, drop);
    expect(Object.keys(synced.items).length).toBe(2);

    const health = (await fetch(`http://127.0.0.1:${HEALTH_PORT}/health`).then((r) => r.json())) as {
      opened: number;
      pending: number;
      lastOpenedAt: string | null;
    };
    expect(health.opened).toBe(2);
    expect(health.pending).toBe(0);
    expect(health.lastOpenedAt).not.toBeNull();
  }, 25 * 60_000);
});
