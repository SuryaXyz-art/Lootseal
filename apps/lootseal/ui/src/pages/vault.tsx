// SPDX-License-Identifier: Apache-2.0
// The vault: items this browser owns, decrypted locally, with rarity proofs,
// gifting, bazaar listing, sale delivery, and per-drop key backup.
import { useMemo, useState } from "react";
import { BadgeCheck, Copy, Download, Gift, Inbox, PackageCheck, Store, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/modal";
import { ItemCard, TierBadge } from "@/components/loot";
import { Empty, PageTitle, Spinner, WalletGate } from "@/components/shell";
import { useDirectory, useDrop, useHolder, type DirectoryDrop } from "@/hooks/use-lootseal";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useWallet } from "@/hooks/use-wallet";
import { useTx } from "@/providers/tx-context";
import {
  cancelListing,
  listItem,
  loadState,
  proveRarity,
  saveState,
  settleListing,
  transferItem,
  type DropLedger,
} from "@/midnight/lootseal-api";
import { walletUserAddress } from "@/lib/addresses";
import { badgesForItem, catalogOf, listingsOf, LISTING_STATUS, topLabel } from "@/lib/drop-view";
import { formatNight, parseNight } from "@/lib/format";
import { tierStyle } from "@/lib/art";
import { hrefFor } from "@/router";
import { decodeText32, lootsealIdOf, parseLootsealId } from "../../../contract/lib.js";
import { decryptBundle, encryptBundle, parseBundle } from "../../../contract/bundle.js";
import type { LootsealPrivateState } from "../../../contract/witnesses.js";

export function VaultPage() {
  const dir = useDirectory();
  return (
    <div>
      <PageTitle
        title="Vault"
        subtitle="Your items, decrypted in this browser from the encrypted deliveries on chain. Nobody else can see what you hold."
      />
      <WalletGate reason="to see your items">
        {dir.loading && !dir.data && <Spinner label="Finding drops…" />}
        {dir.data && dir.data.length === 0 && (
          <Empty icon={<Inbox className="size-8" />} title="No drops yet">
            Items appear here once you open a box.
          </Empty>
        )}
        <div className="space-y-10">
          {dir.data?.map((d) => (
            <DropVault key={d.address} entry={d} />
          ))}
        </div>
      </WalletGate>
    </div>
  );
}

type Action =
  | { kind: "prove"; itemId: string }
  | { kind: "send"; itemId: string }
  | { kind: "list"; itemId: string }
  | { kind: "id" }
  | { kind: "backup" };

function DropVault({ entry }: { entry: DirectoryDrop }) {
  const live = useDrop(entry.address);
  const drop = live.data ?? entry.ledger;
  const holder = useHolder(entry.address, drop);
  const [action, setAction] = useState<Action | null>(null);
  const catalog = useMemo(() => catalogOf(drop), [drop]);
  const listings = useMemo(() => listingsOf(entry.address, drop), [entry.address, drop]);
  const items = Object.entries(holder.state?.items ?? {});
  const hasRequests = holder.ownerKey !== null;
  const name = decodeText32(drop.title);

  if (!holder.state) return null;
  if (items.length === 0 && !holder.state.publisher) return null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <span className="h-6 w-1 rounded-full bg-gradient-to-b from-[var(--sec-a)] to-[var(--sec-b)]" />
          <a href={hrefFor({ name: "drop", address: entry.address })} className="hover:underline">
            {name}
          </a>
          <span className="ml-2 text-sm font-normal text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAction({ kind: "id" })} disabled={!hasRequests}>
            <Inbox /> Receive
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAction({ kind: "backup" })}>
            <Download /> Backup
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">You publish this drop; you hold no items in it.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([itemId, op]) => {
            const c = catalog.find((x) => x.itemType === Number(op.itemType));
            if (!c) return null;
            const listing = listings.find((l) => l.itemId === itemId && !l.stale);
            const badges = badgesForItem(drop, itemId).filter((b) => b.current);
            return (
              <ItemCard
                key={itemId}
                dropAddress={entry.address}
                itemType={c.itemType}
                tier={c.tier}
                name={c.name}
                serial={op.serial}
                top={topLabel(c.tier, drop)}
                footer={
                  <div className="space-y-2">
                    {badges[0] && (
                      <a
                        href={hrefFor({ name: "verify", address: entry.address, badge: badges[0].badgeId })}
                        className="flex items-center gap-1 text-xs text-emerald-300 hover:underline"
                      >
                        <BadgeCheck className="size-3.5" /> {badges.length} rarity proof{badges.length > 1 ? "s" : ""}
                      </a>
                    )}
                    {listing?.status === LISTING_STATUS.PENDING ? (
                      <SettleButton address={entry.address} itemId={itemId} price={listing.price} />
                    ) : listing?.status === LISTING_STATUS.OPEN ? (
                      <ListedRow address={entry.address} itemId={itemId} price={listing.price} />
                    ) : (
                      <div className="grid grid-cols-3 gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "prove", itemId })} aria-label="Prove rarity">
                          <BadgeCheck />
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "send", itemId })} aria-label="Send">
                          <Gift />
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "list", itemId })} aria-label="List on bazaar">
                          <Store />
                        </Button>
                      </div>
                    )}
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      <ProveModal action={action} close={() => setAction(null)} address={entry.address} drop={drop} state={holder.state} onDone={holder.refresh} />
      <SendModal action={action} close={() => setAction(null)} address={entry.address} onDone={holder.refresh} />
      <ListModal action={action} close={() => setAction(null)} address={entry.address} drop={drop} state={holder.state} onDone={holder.refresh} />
      <Modal open={action?.kind === "id"} onClose={() => setAction(null)} title="Receive items in this drop">
        <p className="mb-3 text-sm text-muted-foreground">
          Share this Lootseal ID. Anyone can send you items from {name} with it; the chain never learns it is you.
        </p>
        <CopyField value={lootsealIdOf(entry.address, holder.state)} />
      </Modal>
      <BackupModal action={action} close={() => setAction(null)} address={entry.address} state={holder.state} onDone={holder.refresh} />
    </section>
  );
}

function ListedRow({ address, itemId, price }: { address: string; itemId: string; price: bigint }) {
  const { providers } = useMidnightProviders();
  const tx = useTx();
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">Listed · {formatNight(price)}</span>
      <Button
        size="sm"
        variant="ghost"
        disabled={tx.busy || !providers}
        onClick={() => providers && void tx.run("Cancelling listing", () => cancelListing(providers, address, itemId))}
      >
        Cancel
      </Button>
    </div>
  );
}

function SettleButton({ address, itemId, price }: { address: string; itemId: string; price: bigint }) {
  const { providers } = useMidnightProviders();
  const tx = useTx();
  return (
    <Button
      size="sm"
      className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
      disabled={tx.busy || !providers}
      onClick={() =>
        providers &&
        void tx.run("Delivering to the buyer", () => settleListing(providers, address, itemId), () => `Sold. ${formatNight(price)} sent to you.`)
      }
    >
      <PackageCheck /> Sold! Deliver &amp; get {formatNight(price)}
    </Button>
  );
}

const tierChoices = (tier: number) =>
  Array.from({ length: 5 - tier }, (_, i) => tier + i).map((t) => ({
    value: t,
    label: t === 0 ? "Legendary" : t === 4 ? "Any tier (proves ownership only)" : `${tierStyle(t).name} or rarer`,
  }));

function ProveModal(props: {
  action: Action | null;
  close: () => void;
  address: string;
  drop: DropLedger;
  state: LootsealPrivateState;
  onDone: () => Promise<void>;
}) {
  const { action, close, address, drop, state } = props;
  const { providers } = useMidnightProviders();
  const tx = useTx();
  const open = action?.kind === "prove";
  const itemId = open ? action.itemId : "";
  const op = state.items[itemId];
  const tier = op ? Number(drop.catalogTiers[Number(op.itemType)]) : 4;
  const [maxTier, setMaxTier] = useState<number | null>(null);
  const [context, setContext] = useState("marketplace");
  const chosen = maxTier ?? tier;
  return (
    <Modal open={open} onClose={close} title="Prove rarity">
      <p className="mb-4 text-sm text-muted-foreground">
        Publish a zero-knowledge badge saying this item is at least as rare as you choose. The item itself, its name and serial
        stay private.
      </p>
      <label className="mb-1 block text-xs text-muted-foreground" htmlFor="max-tier">
        Claim
      </label>
      <select
        id="max-tier"
        className="mb-3 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
        value={chosen}
        onChange={(e) => setMaxTier(Number(e.target.value))}
      >
        {tierChoices(tier).map((c) => (
          <option key={c.value} value={c.value}>
            {c.label} — {topLabel(c.value, drop)}
          </option>
        ))}
      </select>
      <label className="mb-1 block text-xs text-muted-foreground" htmlFor="ctx">
        Where you'll share it (up to 32 characters)
      </label>
      <Input id="ctx" value={context} maxLength={32} onChange={(e) => setContext(e.target.value)} />
      <Button
        className="mt-4 w-full"
        disabled={tx.busy || !providers || !context.trim()}
        onClick={async () => {
          if (!providers) return;
          const r = await tx.run("Proving rarity", () => proveRarity(providers, address, itemId, chosen, context.trim()), () => "Badge published.");
          if (r) {
            await props.onDone();
            close();
          }
        }}
      >
        <BadgeCheck /> Publish badge
      </Button>
    </Modal>
  );
}

function SendModal({ action, close, address, onDone }: { action: Action | null; close: () => void; address: string; onDone: () => Promise<void> }) {
  const { providers } = useMidnightProviders();
  const tx = useTx();
  const [to, setTo] = useState("");
  const open = action?.kind === "send";
  let error: string | null = null;
  if (to.trim()) {
    try {
      parseLootsealId(to);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return (
    <Modal open={open} onClose={close} title="Send item">
      <p className="mb-3 text-sm text-muted-foreground">
        Paste the receiver's Lootseal ID for this drop (they find it under Receive). The item is re-encrypted to them inside the proof.
      </p>
      <Input placeholder="ls1:…" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!error} />
      {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
      <Button
        className="mt-4 w-full"
        disabled={tx.busy || !providers || !to.trim() || !!error}
        onClick={async () => {
          if (!providers || !open) return;
          const r = await tx.run("Sending item", () => transferItem(providers, address, action.itemId, to.trim()), () => "Item sent.");
          if (r) {
            setTo("");
            await onDone();
            close();
          }
        }}
      >
        <Gift /> Send
      </Button>
    </Modal>
  );
}

function ListModal(props: {
  action: Action | null;
  close: () => void;
  address: string;
  drop: DropLedger;
  state: LootsealPrivateState;
  onDone: () => Promise<void>;
}) {
  const { action, close, address, drop, state } = props;
  const { providers } = useMidnightProviders();
  const { connectedApi, networkId } = useWallet();
  const tx = useTx();
  const open = action?.kind === "list";
  const itemId = open ? action.itemId : "";
  const op = state.items[itemId];
  const tier = op ? Number(drop.catalogTiers[Number(op.itemType)]) : 4;
  const [price, setPrice] = useState("25");
  const [maxTier, setMaxTier] = useState<number | null>(null);
  const chosen = maxTier ?? tier;
  let priceError: string | null = null;
  let star = 0n;
  try {
    star = parseNight(price);
    if (star <= 0n) priceError = "Price must be above zero";
  } catch (e) {
    priceError = (e as Error).message;
  }
  return (
    <Modal open={open} onClose={close} title="List on the bazaar">
      <p className="mb-4 text-sm text-muted-foreground">
        Buyers see the rarity you prove here, not the item. They pay into escrow; you deliver with one click and get paid in the same
        transaction.
      </p>
      <label className="mb-1 block text-xs text-muted-foreground" htmlFor="price">
        Price (NIGHT)
      </label>
      <Input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      {priceError && <p className="mt-1 text-xs text-rose-300">{priceError}</p>}
      <label className="mb-1 mt-3 block text-xs text-muted-foreground" htmlFor="list-tier">
        Show buyers
      </label>
      <select
        id="list-tier"
        className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm"
        value={chosen}
        onChange={(e) => setMaxTier(Number(e.target.value))}
      >
        {tierChoices(tier).map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <Button
        className="mt-4 w-full"
        disabled={tx.busy || !providers || !!priceError || !connectedApi}
        onClick={async () => {
          if (!providers || !connectedApi || !networkId) return;
          const payout = await walletUserAddress(connectedApi, networkId);
          const r = await tx.run("Listing item", () => listItem(providers, address, itemId, star, chosen, payout), () => "Listed on the bazaar.");
          if (r) {
            await props.onDone();
            close();
          }
        }}
      >
        <Store /> List for {priceError ? "…" : formatNight(star)}
      </Button>
    </Modal>
  );
}

function BackupModal(props: { action: Action | null; close: () => void; address: string; state: LootsealPrivateState; onDone: () => Promise<void> }) {
  const { action, close, address, state } = props;
  const { providers } = useMidnightProviders();
  const tx = useTx();
  const [pass, setPass] = useState("");
  const open = action?.kind === "backup";
  return (
    <Modal open={open} onClose={close} title="Back up or restore your keys for this drop">
      <p className="mb-3 text-sm text-muted-foreground">
        Your owner and encryption keys for this drop live only in this browser. Download an encrypted backup to keep them safe, or
        restore one on a new device. {state.publisher && "This backup includes your publisher secrets (use it for the fulfiller)."}
      </p>
      <Input type="password" placeholder="Backup passphrase (12+ characters)" value={pass} onChange={(e) => setPass(e.target.value)} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          disabled={pass.length < 12}
          onClick={async () => {
            const bundle = await encryptBundle(address, state, pass);
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `lootseal-${state.publisher ? "publisher" : "holder"}-${address.slice(0, 8)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            tx.notify("success", "Backup downloaded", "Keep the file and passphrase somewhere safe.");
          }}
        >
          <Download /> Download
        </Button>
        <label className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-secondary px-4 text-sm font-medium ${pass.length < 12 ? "pointer-events-none opacity-50" : ""}`}>
          <Upload className="size-4" /> Restore
          <input
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || !providers) return;
              await tx.run("Restoring backup", async () => {
                const bundle = parseBundle(await file.text());
                if (bundle.dropAddress !== address) throw new Error("This backup belongs to a different drop");
                const restored = await decryptBundle(bundle, pass);
                const current = await loadState(providers, address);
                await saveState(providers, address, { ...restored, items: { ...(current?.items ?? {}), ...restored.items } });
                await props.onDone();
                return null;
              }, () => "Keys restored.");
            }}
          />
        </label>
      </div>
    </Modal>
  );
}

export function CopyField({ value }: { value: string }) {
  const tx = useTx();
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs">{value}</code>
      <Button
        size="icon"
        variant="secondary"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => tx.notify("success", "Copied"),
            () => tx.notify("error", "Copy failed", "Select the text and copy it manually."),
          );
        }}
      >
        <Copy />
      </Button>
    </div>
  );
}

export { TierBadge };
