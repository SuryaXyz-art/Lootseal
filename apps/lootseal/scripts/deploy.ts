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

// Deploys the Lootseal registry and the demo drop "Genesis Relics" to a
// network, launches the drop (hidden table + odds proof, seed, registry
// entry) and records the result.
//
//   MIDNIGHT_NETWORK=preview yarn deploy
//
// Writes deployments/<network>.json (public, committed) and
// .secrets/<network>/ (gitignored): the deployer wallet seed and the
// encrypted publisher bundle the fulfiller needs. The bundle passphrase is
// BUNDLE_PASSPHRASE, or a generated one written next to the bundle.
// A first run on a remote network prints the wallet's address and waits for
// you to fund it from the faucet.
//
// Resume an interrupted run (same deployer wallet) with
//   RESUME_REGISTRY=<registry> RESUME_DROP=<drop> LOOTSEAL_STATE_STORE=<store>
// where the store is the private-state store the first run used (it holds the
// publisher secrets, saved before every transaction). Only the missing launch
// steps run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { encodeUserAddress, type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import { getConfig } from '../src/config.js';
import { MidnightWalletProvider, syncWallet, type WalletSecret } from '../src/wallet.js';
import { buildProviders } from '../src/providers.js';
import {
  CompiledLootsealContract,
  CompiledRegistryContract,
  ledger,
  registryLedger,
  registryZkConfigPath,
  zkConfigPath,
} from '../contract/index.js';
import { createPublisherPrivateState, fromHex, type LootsealPrivateState } from '../contract/witnesses.js';
import { createRegistryPrivateState } from '../contract/registry-witnesses.js';
import { encodeText32, ITEM_TYPES } from '../contract/lib.js';
import { deployStaged } from '../contract/staged-deploy.js';
import { encryptBundle } from '../contract/bundle.js';

// @ts-expect-error WebSocket global for the indexer client in Node
globalThis.WebSocket = WebSocket;

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });
const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const root = path.resolve(new URL(import.meta.url).pathname, '../..');
const secretsDir = path.join(root, '.secrets', network);
const STAR = 1_000_000n;

// Genesis Relics: 1,000 boxes. Legendary 1% · Epic 4% · Rare 15% · Uncommon 30% · Common 50%.
// The per-item split below is the hidden part; only the tier totals are public.
const CATALOG: [string, number, number][] = [
  ['Dragon Sigil', 0, 4],
  ['Phoenix Crown', 0, 6],
  ['Void Lantern', 1, 18],
  ['Starforged Blade', 1, 22],
  ['Moonlit Aegis', 2, 45],
  ['Tidecaller Horn', 2, 55],
  ['Ember Charm', 2, 50],
  ['Frost Rune', 3, 110],
  ['Thorn Bracer', 3, 95],
  ['Storm Feather', 3, 95],
  ['Copper Key', 4, 90],
  ['Oak Totem', 4, 85],
  ['River Pebble', 4, 80],
  ['Ash Token', 4, 85],
  ['Moss Ring', 4, 80],
  ['Clay Idol', 4, 80],
];

function deployerSecret(): WalletSecret {
  if (network === 'local') return resolveWallet('local').secret;
  if (process.env['DEPLOYER_SEED']) return { kind: 'seed', value: process.env['DEPLOYER_SEED'] };
  mkdirSync(secretsDir, { recursive: true });
  const file = path.join(secretsDir, 'deployer.json');
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({ seed: randomBytes(32).toString('hex'), createdAt: new Date().toISOString() }, null, 2), {
      mode: 0o600,
    });
    logger.info(`Created a deployer wallet seed in ${file} (gitignored).`);
  }
  return { kind: 'seed', value: (JSON.parse(readFileSync(file, 'utf8')) as { seed: string }).seed };
}

async function main() {
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
  const wallet = await MidnightWalletProvider.build(logger, env, deployerSecret());
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 60 * 60_000);
  if (network !== 'local') {
    await waitForNightThenDust(logger, wallet.wallet, wallet.unshieldedKeystore, env, config.faucet, { label: 'deployer' });
  }
  const payout = { bytes: encodeUserAddress(wallet.unshieldedKeystore.getAddress()) };
  const providers = buildProviders(wallet, zkConfigPath, config);
  const registryProviders = buildProviders(wallet, registryZkConfigPath, config);

  const resumeRegistry = process.env['RESUME_REGISTRY'] as ContractAddress | undefined;
  const resumeDrop = process.env['RESUME_DROP'] as ContractAddress | undefined;
  let registryAddress: ContractAddress;
  if (resumeRegistry) {
    registryAddress = resumeRegistry;
    logger.info(`Reusing registry ${registryAddress}`);
  } else {
    logger.info('Deploying the registry…');
    const reg = await (deployContract as any)(registryProviders, {
      compiledContract: CompiledRegistryContract,
      privateStateId: 'registrant',
      initialPrivateState: createRegistryPrivateState(new Uint8Array(32)),
    });
    registryAddress = reg.deployTxData.public.contractAddress as ContractAddress;
    logger.info(`Registry: ${registryAddress}`);
  }

  const counts = [...CATALOG.map(([, , c]) => BigInt(c)), ...Array<bigint>(ITEM_TYPES - CATALOG.length).fill(0n)];
  const tierTotals = [0n, 0n, 0n, 0n, 0n];
  CATALOG.forEach(([, t, c]) => (tierTotals[t] += BigInt(c)));
  const params = {
    title: encodeText32('Genesis Relics'),
    names: [...CATALOG.map(([n]) => encodeText32(n)), ...Array.from({ length: ITEM_TYPES - CATALOG.length }, () => new Uint8Array(32))],
    tiers: [...CATALOG.map(([, t]) => BigInt(t)), ...Array<bigint>(ITEM_TYPES - CATALOG.length).fill(4n)],
    tierTotals,
    totalSupply: tierTotals.reduce((a, b) => a + b, 0n),
    price: 5n * STAR,
    bondAmount: 200n * STAR,
    penaltyPerBox: 2n * STAR,
    saleEnd: BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400),
    fulfillWindow: 60n * 60n,
    settleWindow: 24n * 3_600n,
    payout,
  };
  let address: ContractAddress;
  if (resumeDrop) {
    address = resumeDrop;
    logger.info(`Resuming Genesis Relics at ${address}`);
  } else {
    logger.info('Deploying Genesis Relics (staged)…');
    ({ address } = await deployStaged(
      providers,
      {
        compiledContract: CompiledLootsealContract,
        privateStateId: 'publisher',
        initialPrivateState: createPublisherPrivateState(counts),
        args: [params],
      },
      (p) => logger.info(`  ${JSON.stringify(p)}`),
    ));
  }
  providers.privateStateProvider.setContractAddress(address);
  const publisher = (await providers.privateStateProvider.get('publisher')) as LootsealPrivateState | null;
  if (!publisher?.publisher) throw new Error('No publisher secrets for this drop in the private-state store');
  const call = (circuitId: string) =>
    (submitCallTx as any)(providers, {
      compiledContract: CompiledLootsealContract,
      contractAddress: address,
      privateStateId: 'publisher',
      circuitId,
      args: [],
    });
  const stateNow = async () => ledger((await providers.publicDataProvider.queryContractState(address))!.data).state;
  if ((await stateNow()) === 0) {
    logger.info('Committing the hidden table (odds proof + bond)…');
    await call('commitTable');
  }
  if ((await stateNow()) === 1) {
    logger.info('Committing the master seed…');
    await call('commitSeed');
  }

  const regState = await registryProviders.publicDataProvider.queryContractState(registryAddress);
  const alreadyListed = regState ? registryLedger(regState.data).registered.member(fromHex(address)) : false;
  if (!alreadyListed) {
    logger.info('Registering the drop…');
    registryProviders.privateStateProvider.setContractAddress(registryAddress);
    await registryProviders.privateStateProvider.set('registrant', createRegistryPrivateState(publisher.publisher.secret));
    await (submitCallTx as any)(registryProviders, {
      compiledContract: CompiledRegistryContract,
      contractAddress: registryAddress,
      privateStateId: 'registrant',
      circuitId: 'registerDrop',
      args: [fromHex(address), params.title, BigInt(Math.floor(Date.now() / 1000))],
    });
  }

  providers.privateStateProvider.setContractAddress(address);
  const finalState = (await providers.privateStateProvider.get('publisher')) as LootsealPrivateState;
  const passphrase = process.env['BUNDLE_PASSPHRASE'] ?? randomBytes(18).toString('base64url');
  mkdirSync(secretsDir, { recursive: true });
  const bundlePath = path.join(secretsDir, `publisher-${address.slice(0, 8)}.json`);
  writeFileSync(bundlePath, JSON.stringify(await encryptBundle(address, finalState, passphrase), null, 2), { mode: 0o600 });
  if (!process.env['BUNDLE_PASSPHRASE']) writeFileSync(`${bundlePath}.passphrase`, passphrase, { mode: 0o600 });

  const state = await providers.publicDataProvider.queryContractState(address);
  const drop = ledger(state!.data);
  const record = {
    networkId: config.networkId,
    indexerUri: config.indexer,
    // Record the public indexer even when this run synced through a local
    // cache (MIDNIGHT_INDEXER_WS): the web app reads this file.
    indexerWsUri: process.env['MIDNIGHT_INDEXER_WS'] ? config.indexer.replace(/^http/, 'ws') + '/ws' : config.indexerWS,
    registryAddress,
    featuredDrops: [address],
    faucetUrl: config.faucet,
    deployedAt: new Date().toISOString(),
    drops: [
      {
        address,
        title: 'Genesis Relics',
        totalSupply: Number(drop.totalSupply),
        tierTotals: drop.tierTotals.map(Number),
        priceStar: drop.price.toString(),
        state: Number(drop.state),
      },
    ],
  };
  mkdirSync(path.join(root, 'deployments'), { recursive: true });
  writeFileSync(path.join(root, 'deployments', `${network}.json`), `${JSON.stringify(record, null, 2)}\n`);
  logger.info(`Done. Registry ${registryAddress}, drop ${address}. Publisher bundle: ${bundlePath}`);
  await wallet.stop();
  process.exit(0);
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
