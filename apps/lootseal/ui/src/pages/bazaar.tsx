// SPDX-License-Identifier: Apache-2.0
// The bazaar: items for sale across all drops. Buyers see a rarity bound the
// seller proved in zero knowledge, never the item; payment sits in escrow
// until the seller delivers (or is refunded after the deadline).
import { useMemo, useState } from "react";
import { BadgeCheck, Clock, Loader2, ShoppingBag, Store, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemArt, TierBadge } from "@/components/loot";
import { Empty, PageTitle, Spinner } from "@/components/shell";
import { useDirectory, useHolder, useNow, type DirectoryDrop } from "@/hooks/use-lootseal";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useWallet } from "@/hooks/use-wallet";
import { useTx } from "@/providers/tx-context";
import { buyListing, refundListing } from "@/midnight/lootseal-api";
import { walletUserAddress } from "@/lib/addresses";
import { listingsOf, LISTING_STATUS, topLabel, type ListingView } from "@/lib/drop-view";
import { formatNight, relativeTime } from "@/lib/format";
import { tierStyle, TIER_STYLES } from "@/lib/art";
import { hrefFor } from "@/router";
import { decodeText32 } from "../../../contract/lib.js";
import { cn } from "@/lib/utils";

export function BazaarPage() {
  const dir = useDirectory();
  const [tierFilter, setTierFilter] = useState<number | null>(null);
  const all = useMemo(
    () =>
      (dir.data ?? []).flatMap((d) =>
        listingsOf(d.address, d.ledger)
          .filter((l) => !l.stale && (l.status === LISTING_STATUS.OPEN || l.status === LISTING_STATUS.PENDING))
          .map((l) => ({ listing: l, drop: d })),
      ),
    [dir.data],
  );
  const open = all.filter((x) => x.listing.status === LISTING_STATUS.OPEN && (tierFilter === null || x.listing.maxTier <= tierFilter));
  return (
    <div>
      <PageTitle
        title="Bazaar"
        subtitle="Trade items with rarity proven in zero knowledge. You see how rare an item is guaranteed to be — the seller's proof — and pay into escrow until it's delivered."
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <FilterChip active={tierFilter === null} onClick={() => setTierFilter(null)}>
          All
        </FilterChip>
        {TIER_STYLES.slice(0, 4).map((t, i) => (
          <FilterChip key={t.name} active={tierFilter === i} onClick={() => setTierFilter(i)} color={t.color}>
            {i === 0 ? "Legendary" : `${t.name}+`}
          </FilterChip>
        ))}
      </div>
      <MyPurchases drops={dir.data ?? []} />
      {dir.loading && !dir.data && <Spinner label="Loading listings…" />}
      {dir.data && open.length === 0 && (
        <Empty icon={<Store className="size-8" />} title="Nothing listed right now">
          List an item from your Vault and it shows up here.
        </Empty>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {open.map(({ listing, drop }) => (
          <ListingCard key={`${listing.dropAddress}:${listing.itemId}`} listing={listing} drop={drop} />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn("rounded-full border px-3 py-1 text-sm transition-colors", active ? "border-violet-400/60 bg-violet-500/15" : "border-white/10 hover:bg-white/5")}
      style={color && active ? { color, borderColor: `${color}88` } : undefined}
    >
      {children}
    </button>
  );
}

function ListingCard({ listing, drop }: { listing: ListingView; drop: DirectoryDrop }) {
  const { providers } = useMidnightProviders();
  const { connectedApi, networkId, status } = useWallet();
  const holder = useHolder(drop.address, drop.ledger);
  const tx = useTx();
  const style = tierStyle(listing.maxTier);
  const mine = holder.state?.items[listing.itemId] !== undefined;
  return (
    <div className="glass flex flex-col overflow-hidden rounded-2xl p-3" style={{ boxShadow: `0 0 0 1px ${style.color}22` }}>
      <div className="relative">
        <ItemArt dropAddress={drop.address} itemType={listing.maxTier} tier={listing.maxTier} hidden size={220} className="h-auto w-full" />
        <span className="absolute left-2 top-2">
          <TierBadge tier={listing.maxTier}>
            <BadgeCheck className="size-3" /> {listing.maxTier === 0 ? "Legendary" : listing.maxTier === 4 ? "Any tier" : `${style.name} or rarer`}
          </TierBadge>
        </span>
      </div>
      <div className="mt-3 flex-1">
        <a href={hrefFor({ name: "drop", address: drop.address })} className="text-sm text-muted-foreground hover:underline">
          {decodeText32(drop.ledger.title)}
        </a>
        <p className="font-semibold">Sealed item · {topLabel(listing.maxTier, drop.ledger)}</p>
        <p className="mt-1 text-xs text-muted-foreground">Proven in zero knowledge by the seller. Revealed to you on delivery.</p>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-lg font-bold tabular-nums">{formatNight(listing.price)}</span>
        {mine ? (
          <span className="text-xs text-muted-foreground">Your listing</span>
        ) : (
          <Button
            size="sm"
            className="bg-violet-500 text-white hover:bg-violet-400"
            disabled={tx.busy || !providers || status !== "connected"}
            title={status !== "connected" ? "Connect a wallet to buy" : undefined}
            onClick={async () => {
              if (!providers || !connectedApi || !networkId) return;
              const refundTo = await walletUserAddress(connectedApi, networkId);
              await tx.run(
                "Buying item",
                () => buyListing(providers, drop.address, listing.itemId, refundTo),
                () => "Paid into escrow. The seller delivers next; you're refunded if they don't.",
              );
              await holder.refresh();
            }}
          >
            {tx.busy ? <Loader2 className="animate-spin" /> : <ShoppingBag />} Buy
          </Button>
        )}
      </div>
    </div>
  );
}

/** Purchases waiting for the seller to deliver, with refunds after the deadline. */
function MyPurchases({ drops }: { drops: DirectoryDrop[] }) {
  return (
    <>
      {drops.map((d) => (
        <DropPurchases key={d.address} drop={d} />
      ))}
    </>
  );
}

function DropPurchases({ drop }: { drop: DirectoryDrop }) {
  const holder = useHolder(drop.address, drop.ledger);
  const { providers } = useMidnightProviders();
  const tx = useTx();
  const now = useNow();
  if (!holder.ownerKey) return null;
  const waiting = listingsOf(drop.address, drop.ledger).filter((l) => l.status === LISTING_STATUS.PENDING && l.buyerOwnerPk === holder.ownerKey);
  if (waiting.length === 0) return null;
  return (
    <div className="glass mb-6 rounded-2xl border border-violet-400/20 p-4">
      <p className="mb-2 font-semibold">Waiting for delivery · {decodeText32(drop.ledger.title)}</p>
      <ul className="space-y-2">
        {waiting.map((l) => {
          const late = now >= l.deadline;
          return (
            <li key={l.itemId} className="flex flex-wrap items-center gap-3 text-sm">
              <TierBadge tier={l.maxTier} />
              <span>{formatNight(l.price)} in escrow</span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3.5" /> {late ? "Seller missed the deadline" : `seller delivers ${relativeTime(l.deadline, now)}`}
              </span>
              {late && providers && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={tx.busy}
                  onClick={() => void tx.run("Refunding escrow", () => refundListing(providers, drop.address, l.itemId), () => "Escrow returned to you.")}
                >
                  <Undo2 /> Refund
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
