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

// Lootseal fulfiller: opens a drop's boxes automatically, in order, as soon
// as they are bought, so buyers see their item within a block or two.
//
// It holds the publisher secrets for one drop (imported from the encrypted
// bundle the Studio exports) and a funded wallet for fees. Before every open
// it replays the hidden supply from chain data (contract/lib.ts
// replaySupply), so it never drifts from the chain or from another copy of
// the publisher secrets. GET /health reports its state.
//
//   MIDNIGHT_NETWORK      local | preview | preprod
//   FULFILLER_SEED        hex wallet seed paying the fees (or FULFILLER_MNEMONIC)
//   DROP_ADDRESS          the drop to fulfil
//   BUNDLE_PATH           the publisher bundle (lootseal-publisher-*.json)
//   BUNDLE_PASSPHRASE     its passphrase
//   POLL_MS               fallback poll interval (default 15000)
//   PORT                  health port (default 8787)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { waitForDust } from '@midnight-ntwrk/example-fast-sync';
import { getConfig } from '../src/config.js';
import { MidnightWalletProvider, syncWallet, type WalletSecret } from '../src/wallet.js';
import { buildProviders } from '../src/providers.js';
import { CompiledLootsealContract, ledger, zkConfigPath, DropState } from '../contract/index.js';
import { decryptBundle, parseBundle } from '../contract/bundle.js';
import { withReplayedSupply } from '../contract/lib.js';
import type { LootsealPrivateState } from '../contract/witnesses.js';
import { createQueue, type Health } from './queue.js';

// @ts-expect-error WebSocket global for the indexer client in Node
globalThis.WebSocket = WebSocket;

const STATE_ID = 'fulfiller';
const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    logger.fatal(`${name} is not set`);
    process.exit(2);
  }
  return v;
};

async function main() {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
  const dropAddress = need('DROP_ADDRESS').toLowerCase() as ContractAddress;
  const bundle = parseBundle(await readFile(need('BUNDLE_PATH'), 'utf8'));
  if (bundle.dropAddress !== dropAddress) throw new Error('The bundle belongs to a different drop than DROP_ADDRESS');
  const secrets: LootsealPrivateState = await decryptBundle(bundle, need('BUNDLE_PASSPHRASE'));
  if (!secrets.publisher) throw new Error('The bundle carries no publisher secrets (export it from the Studio as the publisher)');

  const health: Health = {
    status: 'starting',
    network,
    drop: dropAddress,
    opened: 0,
    requested: 0,
    pending: 0,
    lastOpenedAt: null,
    lastError: null,
    startedAt: new Date().toISOString(),
  };
  const port = Number(process.env['PORT'] ?? 8787);
  createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(health.status === 'error' ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }
    res.writeHead(404).end();
  }).listen(port, () => logger.info(`health on :${port}/health`));

  const config = getConfig();
  setNetworkId(config.networkId);
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
  const secret: WalletSecret = process.env['FULFILLER_MNEMONIC']
    ? { kind: 'mnemonic', value: process.env['FULFILLER_MNEMONIC'] }
    : { kind: 'seed', value: need('FULFILLER_SEED') };
  const wallet = await MidnightWalletProvider.build(logger, env, secret);
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 60 * 60_000);
  await waitForDust(logger, wallet.wallet);
  const providers = buildProviders(wallet, zkConfigPath, config);
  providers.privateStateProvider.setContractAddress(dropAddress);
  await providers.privateStateProvider.set(STATE_ID, secrets);

  const read = async () => {
    const state = await providers.publicDataProvider.queryContractState(dropAddress);
    if (!state) throw new Error(`No contract at ${dropAddress} on ${network}`);
    return ledger(state.data);
  };

  const { tick } = createQueue({
    health,
    log: logger,
    read: async () => {
      const drop = await read();
      return { live: drop.state === DropState.LIVE, openedCount: drop.openedCount, requestCount: drop.requestCount };
    },
    open: async () => {
      // Replay the hidden supply from the latest chain state right before
      // proving, so the witnesses match whatever the chain holds now.
      const drop = await read();
      providers.privateStateProvider.setContractAddress(dropAddress);
      const ps = (await providers.privateStateProvider.get(STATE_ID)) as LootsealPrivateState;
      await providers.privateStateProvider.set(STATE_ID, withReplayedSupply(ps, drop));
      await (submitCallTx as any)(providers, {
        compiledContract: CompiledLootsealContract,
        contractAddress: dropAddress,
        privateStateId: STATE_ID,
        circuitId: 'openBox',
        args: [],
      });
    },
  });

  providers.publicDataProvider.contractStateObservable(dropAddress, { type: 'latest' }).subscribe({
    next: () => void tick(),
    error: (e: unknown) => logger.warn({ err: String(e) }, 'state subscription dropped; polling continues'),
  });
  setInterval(() => void tick(), Number(process.env['POLL_MS'] ?? 15_000));
  await tick();
  logger.info(`fulfilling ${dropAddress} on ${network}`);
}

main().catch((e: unknown) => {
  logger.fatal({ err: e instanceof Error ? e.stack : String(e) }, 'fulfiller stopped');
  process.exit(1);
});
