// SPDX-License-Identifier: Apache-2.0
// App configuration, from Vite env vars (see ui/.env.example). The defaults
// point at the public Midnight Preview network and the deployment recorded
// in deployments/preview.json.
import deployment from "../../deployments/preview.json";

export interface AppConfig {
  /** The network the app reads from and asks the wallet to use. */
  networkId: string;
  /** Public indexer endpoints used for reading (no wallet needed). */
  indexerUri: string;
  indexerWsUri: string;
  /** The drop registry contract. */
  registryAddress: string;
  /** Drops shown even before the registry is read (e.g. the demo drop). */
  featuredDrops: string[];
  /** Human-facing faucet for test NIGHT. */
  faucetUrl: string;
  /** Block explorer, if any (tx links are only shown when set). */
  explorerTxUrl: string | null;
}

const env = import.meta.env;

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config: AppConfig = {
  networkId: env.VITE_NETWORK_ID ?? deployment.networkId,
  indexerUri: env.VITE_INDEXER_URI ?? deployment.indexerUri,
  indexerWsUri: env.VITE_INDEXER_WS_URI ?? deployment.indexerWsUri,
  registryAddress: env.VITE_REGISTRY_ADDRESS ?? deployment.registryAddress,
  featuredDrops: env.VITE_FEATURED_DROPS !== undefined ? list(env.VITE_FEATURED_DROPS) : deployment.featuredDrops,
  faucetUrl: env.VITE_FAUCET_URL ?? deployment.faucetUrl,
  explorerTxUrl: env.VITE_EXPLORER_TX_URL ?? null,
};
