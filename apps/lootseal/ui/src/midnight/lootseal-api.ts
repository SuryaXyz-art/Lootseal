// SPDX-License-Identifier: Apache-2.0
// Everything the app does on Midnight. Reads go through a public indexer
// provider (no wallet needed); writes go through the wallet's providers,
// one at a time (the private-state store's contract address is a single
// mutable field, so concurrent calls on two drops could cross wires).
import { submitCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { map, type Observable } from "rxjs";
import { config } from "@/config";
import {
  CompiledLootsealContract,
  PRIVATE_STATE_ID,
  ledger,
  pureCircuits,
  type Ledger,
  type LootsealCircuits,
} from "./contract";
import type { ContractProviders, LootsealProviders } from "./providers";
import {
  Contract as RegistryContract,
  ledger as registryLedger,
  type DropEntry,
} from "../../../contract/managed/registry/contract/index.js";
import { registryWitnesses, type RegistryPrivateState } from "../../../contract/registry-witnesses.js";
import {
  createLootsealPrivateState,
  createPublisherPrivateState,
  fromHex,
  randomBytes,
  toHex,
  type LootsealPrivateState,
} from "../../../contract/witnesses.js";
import {
  DROP_CIRCUITS,
  encodeText32,
  parseLootsealId,
  syncVault,
  withReplayedSupply,
} from "../../../contract/lib.js";
import { deployStaged, installMissingCircuits, missingCircuits, type StagedProgress } from "../../../contract/staged-deploy.js";
import type { DropParams } from "../../../contract/managed/lootseal/contract/index.js";

export type { Ledger as DropLedger };
export type RegistryCircuits = "registerDrop";
export type RegistryProviders = ContractProviders<RegistryCircuits>;

export const REGISTRY_ZK_PATH = "managed/registry";
const REGISTRY_STATE_ID = "lootsealRegistrant";

export const CompiledRegistryContract = CompiledContract.make("RegistryContract", RegistryContract).pipe(
  CompiledContract.withWitnesses(registryWitnesses),
  CompiledContract.withCompiledFileAssets(REGISTRY_ZK_PATH),
);

// ─── Public reads ───────────────────────────────────────────────────────────

let reader: PublicDataProvider | null = null;

/** A read-only indexer client for the app's network (no wallet needed). */
export function publicData(): PublicDataProvider {
  reader ??= indexerPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
    window.WebSocket as unknown as Parameters<typeof indexerPublicDataProvider>[2],
  );
  return reader;
}

export async function readDrop(address: string): Promise<Ledger | null> {
  const state = await publicData().queryContractState(address as ContractAddress);
  return state ? ledger(state.data) : null;
}

export function drop$(address: string): Observable<Ledger> {
  return publicData()
    .contractStateObservable(address as ContractAddress, { type: "latest" })
    .pipe(map((s) => ledger(s.data)));
}

export interface RegistryEntry {
  index: number;
  address: string;
  title: Uint8Array;
  publisherPk: Uint8Array;
  registeredAt: bigint;
}

export async function readRegistry(): Promise<RegistryEntry[]> {
  if (!config.registryAddress) return [];
  const state = await publicData().queryContractState(config.registryAddress as ContractAddress);
  if (!state) return [];
  const reg = registryLedger(state.data);
  const out: RegistryEntry[] = [];
  for (const [index, entry] of reg.drops as Iterable<[bigint, DropEntry]>) {
    out.push({
      index: Number(index),
      address: toHex(entry.dropAddress),
      title: entry.title,
      publisherPk: entry.publisherPk,
      registeredAt: entry.registeredAt,
    });
  }
  return out.sort((a, b) => b.index - a.index);
}

/** A registry entry is genuine only if the drop at that address stores the same publisher key. */
export const entryMatchesDrop = (entry: RegistryEntry, drop: Ledger): boolean =>
  toHex(entry.publisherPk) === toHex(drop.publisherPk);

/** Every drop circuit is installed (staged deploys finish with maintenance txs). */
export async function dropIsComplete(address: string): Promise<boolean> {
  return (await missingCircuits({ publicDataProvider: publicData() } as never, address as ContractAddress, DROP_CIRCUITS)).length === 0;
}

// ─── One transaction at a time ──────────────────────────────────────────────

let queue: Promise<unknown> = Promise.resolve();

export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

// ─── Private state ──────────────────────────────────────────────────────────

export async function loadState(providers: LootsealProviders, address: string): Promise<LootsealPrivateState | null> {
  providers.privateStateProvider.setContractAddress(address as ContractAddress);
  return (await providers.privateStateProvider.get(PRIVATE_STATE_ID)) as LootsealPrivateState | null;
}

export async function saveState(providers: LootsealProviders, address: string, ps: LootsealPrivateState): Promise<void> {
  providers.privateStateProvider.setContractAddress(address as ContractAddress);
  await providers.privateStateProvider.set(PRIVATE_STATE_ID, ps);
}

/** This browser's identity for a drop, created on first use. */
export async function ensureHolderState(providers: LootsealProviders, address: string): Promise<LootsealPrivateState> {
  return enqueue(async () => {
    const existing = await loadState(providers, address);
    if (existing) return existing;
    const fresh = createLootsealPrivateState();
    await saveState(providers, address, fresh);
    return fresh;
  });
}

/** Re-decrypts the drop's deliveries with this browser's keys and stores the owned items. */
export async function syncHolder(providers: LootsealProviders, address: string, drop: Ledger): Promise<LootsealPrivateState> {
  return enqueue(async () => {
    const ps = (await loadState(providers, address)) ?? createLootsealPrivateState();
    const next = syncVault(address, ps, drop);
    await saveState(providers, address, next);
    return next;
  });
}

export const ownerKeyFor = (address: string, ps: LootsealPrivateState): string =>
  toHex(pureCircuits.holderKey(fromHex(address), ps.holderSecret));

// ─── Calls ──────────────────────────────────────────────────────────────────

export interface TxResult {
  txId: string;
}

async function callDrop(
  providers: LootsealProviders,
  address: string,
  circuitId: LootsealCircuits,
  args: unknown[],
  prepare?: (ps: LootsealPrivateState, drop: Ledger) => LootsealPrivateState,
): Promise<TxResult> {
  return enqueue(async () => {
    if (prepare) {
      const ps = await loadState(providers, address);
      const drop = await readDrop(address);
      if (!ps || !drop) throw new Error("This drop or its private state was not found");
      await saveState(providers, address, prepare(ps, drop));
    }
    providers.privateStateProvider.setContractAddress(address as ContractAddress);
    const result = await (submitCallTx as unknown as (p: unknown, o: unknown) => Promise<{ public: { txId: string } }>)(
      providers,
      {
        compiledContract: CompiledLootsealContract,
        contractAddress: address,
        privateStateId: PRIVATE_STATE_ID,
        circuitId,
        args,
      },
    );
    return { txId: String(result.public.txId) };
  });
}

/** Publisher calls replay the hidden supply from the chain first, so any copy of the secrets is current. */
const replay = (ps: LootsealPrivateState, drop: Ledger) => withReplayedSupply(ps, drop);

const now = () => BigInt(Math.floor(Date.now() / 1000));

export const buyBox = (p: LootsealProviders, address: string, refundTo: { bytes: Uint8Array }) =>
  callDrop(p, address, "requestBox", [randomBytes(32), refundTo, now()]);

export const openNextBox = (p: LootsealProviders, address: string) => callDrop(p, address, "openBox", [], replay);

export const claimRefund = (p: LootsealProviders, address: string, requestId: bigint) =>
  callDrop(p, address, "claimRefund", [requestId]);

export const proveRarity = (p: LootsealProviders, address: string, itemId: string, maxTier: number, context: string) =>
  callDrop(p, address, "proveRarityTier", [fromHex(itemId), BigInt(maxTier), encodeText32(context)]);

export async function transferItem(p: LootsealProviders, address: string, itemId: string, lootsealId: string) {
  const to = parseLootsealId(lootsealId);
  return callDrop(p, address, "transferItem", [fromHex(itemId), to.ownerPk, to.encKey]);
}

export const listItem = (
  p: LootsealProviders,
  address: string,
  itemId: string,
  price: bigint,
  maxTier: number,
  payout: { bytes: Uint8Array },
) => callDrop(p, address, "listItem", [fromHex(itemId), price, BigInt(maxTier), payout]);

export const buyListing = (p: LootsealProviders, address: string, itemId: string, refundTo: { bytes: Uint8Array }) =>
  callDrop(p, address, "buyListing", [fromHex(itemId), refundTo, now()]);

export const settleListing = (p: LootsealProviders, address: string, itemId: string) =>
  callDrop(p, address, "settleListing", [fromHex(itemId)]);

export const cancelListing = (p: LootsealProviders, address: string, itemId: string) =>
  callDrop(p, address, "cancelListing", [fromHex(itemId)]);

export const refundListing = (p: LootsealProviders, address: string, itemId: string) =>
  callDrop(p, address, "refundListing", [fromHex(itemId)]);

export const claimProceeds = (p: LootsealProviders, address: string) => callDrop(p, address, "claimProceeds", []);

export const finalReveal = (p: LootsealProviders, address: string) => callDrop(p, address, "finalReveal", [], replay);

export const verifyOdds = (p: LootsealProviders, address: string) => callDrop(p, address, "verifyOdds", []);

// ─── Creating a drop ────────────────────────────────────────────────────────

export type CreateProgress =
  | StagedProgress
  | { step: "committingTable"; address: string }
  | { step: "committingSeed"; address: string }
  | { step: "registering"; address: string }
  | { step: "done"; address: string };

export interface NewDrop {
  params: DropParams;
  /** Hidden per-item supply (16 entries). */
  counts: bigint[];
}

/**
 * Deploys a drop (staged), commits its hidden table and seed, and lists it
 * in the registry. Each step is a separate wallet approval. If it stops
 * part-way, `resumeDrop` picks it up from the chain state.
 */
export async function createDrop(
  providers: LootsealProviders,
  registryProviders: RegistryProviders,
  drop: NewDrop,
  onProgress: (p: CreateProgress) => void,
): Promise<string> {
  const initialPrivateState = createPublisherPrivateState(drop.counts);
  const { address } = await enqueue(() =>
    deployStaged(
      providers,
      {
        compiledContract: CompiledLootsealContract,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState,
        args: [drop.params],
      },
      onProgress,
    ),
  );
  rememberMyDrop(address);
  await resumeDrop(providers, registryProviders, address, onProgress);
  return address;
}

/** Finishes whatever launch steps a drop is still missing. */
export async function resumeDrop(
  providers: LootsealProviders,
  registryProviders: RegistryProviders,
  address: string,
  onProgress: (p: CreateProgress) => void,
): Promise<void> {
  const missing = await missingCircuits(providers, address as ContractAddress, DROP_CIRCUITS);
  if (missing.length > 0) {
    await enqueue(() => installMissingCircuits(providers, address as ContractAddress, DROP_CIRCUITS, null, onProgress));
  }
  let drop = await readDrop(address);
  if (!drop) throw new Error("The drop is not on chain yet");
  if (drop.state === 0) {
    onProgress({ step: "committingTable", address });
    await callDrop(providers, address, "commitTable", []);
    drop = await readDrop(address);
  }
  if (drop && drop.state === 1) {
    onProgress({ step: "committingSeed", address });
    await callDrop(providers, address, "commitSeed", []);
  }
  const entries = await readRegistry();
  if (!entries.some((e) => e.address === address) && config.registryAddress) {
    onProgress({ step: "registering", address });
    const ps = await enqueue(() => loadState(providers, address));
    if (!ps?.publisher) throw new Error("This browser does not hold the publisher secrets for this drop");
    const title = (await readDrop(address))!.title;
    await enqueue(async () => {
      registryProviders.privateStateProvider.setContractAddress(config.registryAddress as ContractAddress);
      const state: RegistryPrivateState = { registrantSecret: ps.publisher!.secret };
      const store = registryProviders.privateStateProvider as unknown as {
        set: (id: string, s: RegistryPrivateState) => Promise<void>;
      };
      await store.set(REGISTRY_STATE_ID, state);
      await (submitCallTx as unknown as (p: unknown, o: unknown) => Promise<unknown>)(registryProviders, {
        compiledContract: CompiledRegistryContract,
        contractAddress: config.registryAddress,
        privateStateId: REGISTRY_STATE_ID,
        circuitId: "registerDrop",
        args: [fromHex(address), title, now()],
      });
    });
  }
  onProgress({ step: "done", address });
}

// ─── Drops this browser publishes or follows ────────────────────────────────

const MY_DROPS_KEY = "lootseal:my-drops";

export function myDrops(): string[] {
  try {
    const raw = window.localStorage.getItem(MY_DROPS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberMyDrop(address: string): void {
  try {
    const next = [address, ...myDrops().filter((a) => a !== address)];
    window.localStorage.setItem(MY_DROPS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the drop is still in the registry */
  }
}
