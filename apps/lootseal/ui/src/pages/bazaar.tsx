// SPDX-License-Identifier: Apache-2.0
// The bazaar: items for sale across all drops. Buyers see a rarity bound the
// seller proved in zero knowledge, never the item; payment sits in escrow
// until the seller delivers (or is refunded after the deadline).
import { useMemo, useState } from "react";
import { ArrowDownUp, BadgeCheck, Clock, History, Loader2, ShieldCheck, ShoppingBag, Store, Undo2 } from "lucide-react";
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
import { Reveal } from "@/components/reveal";

export function BazaarPage() {
  const dir = useDirectory();
  const [tierFilter, setTierFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("price-asc");
  // Every listing ever made, across drops: the market's whole history.
  const every = useMemo(
    () => (dir.data ?? []).flatMap((d) => listingsOf(d.address, d.ledger).map((l) => ({ listing: l, drop: d }))),
    [dir.data],
  );
  const live = every.filter((x) => !x.listing.stale && x.listing.status === LISTING_STATUS.OPEN);
  const open = live
    .filter((x) => tierFilter === null || x.listing.maxTier <= tierFilter)
    .sort((a, b) =>
      sort === "rarest"
        ? a.listing.maxTier - b.listing.maxTier || Number(a.listing.price - b.listing.price)
        : sort === "price-desc"
          ? Number(b.listing.price - a.listing.price)
          : Number(a.listing.price - b.listing.price),
    );
  const sold = every.filter((x) => x.listing.status === LISTING_STATUS.SOLD);
  const escrow = every.filter((x) => x.listing.status === LISTING_STATUS.PENDING);
  const stats = {
    open: live.length,
    floor: live.length ? live.reduce((m, x) => (x.listing.price < m ? x.listing.price : m), live[0]!.listing.price) : null,
    sold: sold.length,
    volume: sold.reduce((n, x) => n + x.listing.price, 0n),
    escrow: escrow.reduce((n, x) => n + x.listing.price, 0n),
  };
  return (
    <div>
      <PageTitle
        title="Bazaar"
        subtitle="Trade items with rarity proven in zero knowledge. You see how rare an item is guaranteed to be — the seller's proof — and pay into escrow until it's delivered."
      />
      {dir.data && every.length > 0 && (
        <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MarketStat label="Listed now" value={stats.open.toLocaleString()} />
          <MarketStat label="Floor price" value={stats.floor === null ? "—" : formatNight(stats.floor)} />
          <MarketStat label="Items sold" value={stats.sold.toLocaleString()} />
          <MarketStat label="Volume traded" value={formatNight(stats.volume)} />
          <MarketStat label="In escrow" value={formatNight(stats.escrow)} />
        </dl>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <FilterChip active={tierFilter === null} onClick={() => setTierFilter(null)}>
          All
        </FilterChip>
        {TIER_STYLES.slice(0, 4).map((t, i) => (
          <FilterChip key={t.name} active={tierFilter === i} onClick={() => setTierFilter(i)} color={t.color}>
            {i === 0 ? "Legendary" : `${t.name}+`}
          </FilterChip>
        ))}
        <label className="ml-auto inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowDownUp className="size-4" />
          <span className="sr-only">Sort listings</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-foreground"
          >
            <option value="price-asc">Cheapest first</option>
            <option value="price-desc">Priciest first</option>
            <option value="rarest">Rarest first</option>
          </select>
        </label>
      </div>
      <MyPurchases drops={dir.data ?? []} />
      {dir.loading && !dir.data && <Spinner label="Loading listings…" />}
      {dir.data && open.length === 0 && (
        <Empty icon={<Store className="size-8" />} title={tierFilter === null ? "Nothing listed right now" : `No ${TIER_STYLES[tierFilter]!.name}${tierFilter === 0 ? "" : "+"} listings right now`}>
          <p>Every listing is an item someone pulled from a box. To put one up:</p>
          <ol className="mx-auto mt-3 max-w-xs space-y-1.5 text-left">
            {["Open a box on any drop", "Wait for it to open — the item lands in your Vault", "Click List on the item and set a price"].map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--sec-a)] to-[var(--sec-b)] text-[11px] font-bold text-[#140f33]">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <a href={hrefFor({ name: "home" })} className="btn-glow rounded-lg px-4 py-2 text-sm font-semibold">
              Browse drops
            </a>
            <a href={hrefFor({ name: "vault" })} className="btn-ghost-glow rounded-lg px-4 py-2 text-sm font-semibold">
              Open your Vault
            </a>
          </div>
        </Empty>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {open.map(({ listing, drop }, i) => (
          <Reveal key={`${listing.dropAddress}:${listing.itemId}`} delay={(i % 4) * 80}>
            <ListingCard listing={listing} drop={drop} />
          </Reveal>
        ))}
      </div>
      {(sold.length > 0 || escrow.length > 0) && <RecentTrades sold={sold} escrow={escrow} />}
    </div>
  );
}

type Sort = "price-asc" | "price-desc" | "rarest";

function MarketStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-xl px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-gradient mt-0.5 font-[family-name:var(--font-display)] text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** Settled sales and purchases sitting in escrow: the market's track record. */
function RecentTrades({ sold, escrow }: { sold: { listing: ListingView; drop: DirectoryDrop }[]; escrow: { listing: ListingView; drop: DirectoryDrop }[] }) {
  const rows = [...escrow.map((x) => ({ ...x, state: "escrow" as const })), ...sold.map((x) => ({ ...x, state: "sold" as const }))];
  return (
    <section className="mt-12">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
        <History className="size-5 sec-text" /> Recent trades
      </h2>
      <div className="glass overflow-hidden rounded-2xl">
        <ul className="divide-y divide-white/5">
          {rows.map(({ listing, drop, state }) => (
            <li key={`${listing.dropAddress}:${listing.itemId}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <ItemArt dropAddress={drop.address} itemType={listing.maxTier} tier={listing.maxTier} hidden size={36} />
              <TierBadge tier={listing.maxTier}>{listing.maxTier === 0 ? "Legendary" : listing.maxTier === 4 ? "Any tier" : `${tierStyle(listing.maxTier).name}+`}</TierBadge>
              <a href={hrefFor({ name: "drop", address: drop.address })} className="text-muted-foreground hover:underline">
                {decodeText32(drop.ledger.title)}
              </a>
              <span className="ml-auto font-semibold tabular-nums">{formatNight(listing.price)}</span>
              {state === "sold" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
                  <BadgeCheck className="size-3.5" /> Delivered &amp; paid
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
                  <Clock className="size-3.5" /> In escrow
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FilterChip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn("rounded-full border px-3 py-1 text-sm transition-colors", active ? "border-[color-mix(in_oklab,var(--sec-a)_60%,transparent)] bg-[color-mix(in_oklab,var(--sec-a)_15%,transparent)] shadow-[0_0_14px_-4px_var(--sec-a)]" : "border-white/10 hover:bg-white/5")}
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
    <div
      className="glass tilt group flex h-full flex-col overflow-hidden rounded-2xl p-3"
      style={{ boxShadow: `0 0 0 1px ${style.color}33, 0 18px 40px -22px ${style.glow}` }}
    >
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
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-300/90">
          <ShieldCheck className="size-3.5" /> Escrow-protected: refunded if not delivered
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-lg font-bold tabular-nums">{formatNight(listing.price)}</span>
        {mine ? (
          <span className="text-xs text-muted-foreground">Your listing</span>
        ) : (
          <Button
            size="sm"
            className="btn-glow"
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
    <div className="glass mb-6 rounded-2xl border border-[color-mix(in_oklab,var(--sec-a)_25%,transparent)] p-4">
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
