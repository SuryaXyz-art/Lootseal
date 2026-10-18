// SPDX-License-Identifier: Apache-2.0
// Data hooks: live drop state, the drop directory, the clock, and this
// browser's identity and vault for a drop.
import { useCallback, useEffect, useMemo, useState } from "react";
import { config } from "@/config";
import {
  drop$,
  entryMatchesDrop,
  myDrops,
  ownerKeyFor,
  readDrop,
  readRegistry,
  syncHolder,
  ensureHolderState,
  type DropLedger,
  type RegistryEntry,
} from "@/midnight/lootseal-api";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { errorMessage } from "@/lib/errors";
import { nowSec } from "@/lib/format";
import { pureCircuits } from "@/midnight/contract";
import { toHex, type LootsealPrivateState } from "../../../contract/witnesses.js";

export interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** The live public state of one drop (pushed by the indexer). */
export function useDrop(address: string | null): Loadable<DropLedger> {
  const [state, setState] = useState<Loadable<DropLedger>>({ data: null, loading: !!address, error: null });
  useEffect(() => {
    if (!address) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState({ data: null, loading: true, error: null });
    readDrop(address)
      .then((d) => {
        if (!alive) return;
        if (!d) setState({ data: null, loading: false, error: "No Lootseal drop exists at this address on this network." });
        else setState({ data: d, loading: false, error: null });
      })
      .catch((e: unknown) => alive && setState({ data: null, loading: false, error: errorMessage(e, "Could not read the drop") }));
    const sub = drop$(address).subscribe({
      next: (d) => alive && setState({ data: d, loading: false, error: null }),
      error: () => {
        /* the initial read already reported failures; keep the last state */
      },
    });
    return () => {
      alive = false;
      sub.unsubscribe();
    };
  }, [address]);
  return state;
}

export interface DirectoryDrop {
  address: string;
  ledger: DropLedger;
  /** Listed in the registry with a matching publisher key. */
  verified: boolean;
  registeredAt: bigint | null;
}

/** Every drop the app knows: the registry (verified entries), featured drops and this browser's own. */
export function useDirectory(refreshKey: unknown = null): Loadable<DirectoryDrop[]> & { reload: () => void } {
  const [state, setState] = useState<Loadable<DirectoryDrop[]>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const entries = await readRegistry().catch(() => [] as RegistryEntry[]);
      const byAddress = new Map<string, RegistryEntry>();
      for (const e of entries) if (!byAddress.has(e.address)) byAddress.set(e.address, e);
      const addresses = [...new Set([...config.featuredDrops, ...myDrops(), ...byAddress.keys()].map((a) => a.toLowerCase()))];
      const drops = await Promise.all(
        addresses.map(async (address): Promise<DirectoryDrop | null> => {
          const ledger = await readDrop(address).catch(() => null);
          if (!ledger) return null;
          const entry = byAddress.get(address);
          const verified = entry ? entryMatchesDrop(entry, ledger) : false;
          // Registry entries that fail the key check are spam: hide them.
          if (entry && !verified && !config.featuredDrops.includes(address) && !myDrops().includes(address)) return null;
          return { address, ledger, verified, registeredAt: entry?.registeredAt ?? null };
        }),
      );
      if (!alive) return;
      setState({ data: drops.filter((d): d is DirectoryDrop => d !== null), loading: false, error: null });
    })().catch((e: unknown) => alive && setState({ data: null, loading: false, error: errorMessage(e, "Could not load drops") }));
    return () => {
      alive = false;
    };
  }, [tick, refreshKey]);

  return { ...state, reload };
}

/** Seconds since the epoch, ticking every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(nowSec);
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowSec()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface Holder {
  /** Wallet connected and private-state store unlocked. */
  ready: boolean;
  state: LootsealPrivateState | null;
  ownerKey: string | null;
  isPublisher: boolean;
  error: string | null;
  /** Re-decrypts this drop's deliveries. */
  refresh: () => Promise<void>;
}

/**
 * This browser's identity in a drop: created on first use, kept in the
 * encrypted private-state store, re-synced whenever the drop changes.
 */
export function useHolder(address: string | null, drop: DropLedger | null): Holder {
  const { providers } = useMidnightProviders();
  const [ps, setPs] = useState<LootsealPrivateState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!providers || !address || !drop) return;
    try {
      await ensureHolderState(providers, address);
      setPs(await syncHolder(providers, address, drop));
      setError(null);
    } catch (e: unknown) {
      setError(errorMessage(e, "Could not read your private state for this drop"));
    }
  }, [providers, address, drop]);

  useEffect(() => {
    setPs(null);
  }, [providers, address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ownerKey = useMemo(() => (ps && address ? ownerKeyFor(address, ps) : null), [ps, address]);
  const isPublisher = !!(ps?.publisher && drop && toHex(pureCircuits.publisherKey(ps.publisher.secret)) === toHex(drop.publisherPk));
  return { ready: !!providers, state: ps, ownerKey, isPublisher, error, refresh };
}
