// SPDX-License-Identifier: Apache-2.0
// Publisher Studio: design a drop, launch it (deploy, install circuits,
// commit the hidden table and seed, register), and run it.
import { useEffect, useMemo, useState } from "react";
import { Check, Circle, Coins, Eye, Loader2, Plus, Rocket, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemArt, OddsBars } from "@/components/loot";
import { Empty, PageTitle, WalletGate } from "@/components/shell";
import { Chip } from "@/pages/home";
import { useDrop, useHolder, useNow } from "@/hooks/use-lootseal";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useWallet } from "@/hooks/use-wallet";
import { useTx } from "@/providers/tx-context";
import {
  claimProceeds,
  createDrop,
  dropIsComplete,
  finalReveal,
  myDrops,
  openNextBox,
  REGISTRY_ZK_PATH,
  resumeDrop,
  type CreateProgress,
  type RegistryCircuits,
} from "@/midnight/lootseal-api";
import { walletUserAddress } from "@/lib/addresses";
import { DROP_STATE, pendingQueue, phaseOf, PHASE_LABEL } from "@/lib/drop-view";
import { formatNight, nowSec, parseNight, relativeTime } from "@/lib/format";
import { TIER_STYLES, tierStyle } from "@/lib/art";
import { hrefFor } from "@/router";
import { decodeText32, encodeText32, ITEM_TYPES } from "../../../contract/lib.js";
import { pureCircuits } from "@/midnight/contract";
import { toHex } from "../../../contract/witnesses.js";
import { cn } from "@/lib/utils";

interface ItemDraft {
  name: string;
  tier: number;
  count: string;
}

const TEMPLATE: ItemDraft[] = [
  ["Dragon Sigil", 0, 5],
  ["Phoenix Crown", 0, 5],
  ["Void Lantern", 1, 20],
  ["Starforged Blade", 1, 20],
  ["Moonlit Aegis", 2, 50],
  ["Tidecaller Horn", 2, 50],
  ["Ember Charm", 2, 50],
  ["Frost Rune", 3, 100],
  ["Thorn Bracer", 3, 100],
  ["Storm Feather", 3, 100],
  ["Copper Key", 4, 84],
  ["Oak Totem", 4, 84],
  ["River Pebble", 4, 83],
  ["Ash Token", 4, 83],
  ["Moss Ring", 4, 83],
  ["Clay Idol", 4, 83],
].map(([name, tier, count]) => ({ name: name as string, tier: tier as number, count: String(count) }));

const byteLen = (s: string) => new TextEncoder().encode(s).length;

export function StudioPage() {
  const [tab, setTab] = useState<"create" | "manage">(myDrops().length > 0 ? "manage" : "create");
  return (
    <div>
      <PageTitle
        title="Studio"
        subtitle="Launch a drop whose odds are proven at launch, and run it. Your hidden table, seed and keys never leave this browser."
        actions={
          <div className="flex rounded-xl border border-white/10 p-1">
            {(["create", "manage"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn("rounded-lg px-4 py-1.5 text-sm", tab === t ? "btn-glow" : "text-muted-foreground hover:text-foreground")}
              >
                {t === "create" ? "New drop" : "My drops"}
              </button>
            ))}
          </div>
        }
      />
      <WalletGate reason="to publish drops">{tab === "create" ? <CreateDrop onLaunched={() => setTab("manage")} /> : <ManageDrops />}</WalletGate>
    </div>
  );
}

// ─── Create ─────────────────────────────────────────────────────────────────

function CreateDrop({ onLaunched }: { onLaunched: () => void }) {
  const { providers, providersFor } = useMidnightProviders();
  const { connectedApi, networkId } = useWallet();
  const tx = useTx();
  const [title, setTitle] = useState("Genesis Relics");
  const [items, setItems] = useState<ItemDraft[]>(TEMPLATE);
  const [price, setPrice] = useState("5");
  const [days, setDays] = useState("14");
  const [fulfillMin, setFulfillMin] = useState("60");
  const [settleHours, setSettleHours] = useState("24");
  const [bond, setBond] = useState("200");
  const [penalty, setPenalty] = useState("2");
  const [progress, setProgress] = useState<CreateProgress | null>(null);

  const totals = useMemo(() => {
    const t = [0n, 0n, 0n, 0n, 0n];
    for (const it of items) if (/^\d+$/.test(it.count)) t[it.tier] = (t[it.tier] ?? 0n) + BigInt(it.count);
    return t;
  }, [items]);
  const supply = totals.reduce((a, b) => a + b, 0n);

  const errors: string[] = [];
  if (!title.trim()) errors.push("Give the drop a title.");
  if (byteLen(title) > 32) errors.push("The title must fit in 32 bytes.");
  if (items.length === 0) errors.push("Add at least one item.");
  items.forEach((it, i) => {
    if (!it.name.trim()) errors.push(`Item ${i + 1} needs a name.`);
    else if (byteLen(it.name) > 32) errors.push(`"${it.name}" is longer than 32 bytes.`);
    if (!/^\d+$/.test(it.count) || BigInt(it.count) === 0n) errors.push(`"${it.name || `Item ${i + 1}`}" needs a supply of at least 1.`);
  });
  if (new Set(items.map((i) => i.name.trim())).size !== items.length) errors.push("Item names must be unique.");
  if (supply > 4_000_000_000n) errors.push("Total supply is too large.");
  const amounts = (() => {
    try {
      const p = parseNight(price);
      const b = parseNight(bond);
      const pen = parseNight(penalty);
      if (pen > b) errors.push("The refund penalty can't exceed the bond.");
      if (p === 0n) errors.push("Set a price above zero.");
      return { p, b, pen };
    } catch (e) {
      errors.push((e as Error).message);
      return null;
    }
  })();
  const numbers = [days, fulfillMin, settleHours].every((v) => /^\d+$/.test(v) && Number(v) > 0);
  if (!numbers) errors.push("Durations must be whole numbers above zero.");

  const launching = progress !== null && progress.step !== "done";

  const launch = async () => {
    if (!providers || !providersFor || !connectedApi || !networkId || !amounts) return;
    const payout = await walletUserAddress(connectedApi, networkId);
    const padded = [...items, ...Array.from({ length: ITEM_TYPES - items.length }, () => ({ name: "", tier: 4, count: "0" }))];
    const params = {
      title: encodeText32(title.trim()),
      names: padded.map((i) => encodeText32(i.name.trim())),
      tiers: padded.map((i) => BigInt(i.tier)),
      tierTotals: totals,
      totalSupply: supply,
      price: amounts.p,
      bondAmount: amounts.b,
      penaltyPerBox: amounts.pen,
      saleEnd: BigInt(nowSec() + Number(days) * 86_400),
      fulfillWindow: BigInt(Number(fulfillMin) * 60),
      settleWindow: BigInt(Number(settleHours) * 3_600),
      payout,
    };
    const registryProviders = await providersFor<RegistryCircuits>(REGISTRY_ZK_PATH);
    const address = await tx.run(
      "Launching your drop",
      () => createDrop(providers, registryProviders, { params, counts: padded.map((i) => BigInt(i.count || "0")) }, setProgress),
      () => "Your drop is live.",
    );
    if (address) onLaunched();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="glass space-y-4 rounded-2xl p-5">
          <h2 className="flex items-center gap-3 font-semibold"><span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[var(--sec-a)] to-[var(--sec-b)] text-sm font-bold text-[#140f33] shadow-[0_0_18px_-4px_var(--sec-a)]">1</span>The drop</h2>
          <Field label="Title (shown to buyers)">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={32} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Box price (NIGHT)">
              <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Sale length (days)">
              <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label="Open each box within (min)">
              <Input inputMode="numeric" value={fulfillMin} onChange={(e) => setFulfillMin(e.target.value)} />
            </Field>
            <Field label="Bond you post (NIGHT)">
              <Input inputMode="decimal" value={bond} onChange={(e) => setBond(e.target.value)} />
            </Field>
            <Field label="Penalty per late box (NIGHT)">
              <Input inputMode="decimal" value={penalty} onChange={(e) => setPenalty(e.target.value)} />
            </Field>
            <Field label="Sellers deliver within (h)">
              <Input inputMode="numeric" value={settleHours} onChange={(e) => setSettleHours(e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-3 font-semibold"><span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[var(--sec-a)] to-[var(--sec-b)] text-sm font-bold text-[#140f33] shadow-[0_0_18px_-4px_var(--sec-a)]">2</span>Items and hidden supply</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setItems(TEMPLATE)}>
                <Wand2 /> Use template
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={items.length >= ITEM_TYPES}
                onClick={() => setItems([...items, { name: "", tier: 4, count: "10" }])}
              >
                <Plus /> Add item
              </Button>
            </div>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Names and tiers are public. <b className="text-foreground">How many of each item exist stays secret</b>: only the per-tier totals are
            published, and a zero-knowledge proof shows they match. Up to {ITEM_TYPES} items.
          </p>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[40px_1fr_120px_90px_36px] items-center gap-2">
                <ItemArt dropAddress={`draft:${title}`} itemType={i} tier={it.tier} size={40} />
                <Input
                  aria-label={`Item ${i + 1} name`}
                  value={it.name}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <select
                  aria-label={`Item ${i + 1} tier`}
                  className="h-9 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
                  style={{ color: tierStyle(it.tier).color }}
                  value={it.tier}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, tier: Number(e.target.value) } : x)))}
                >
                  {TIER_STYLES.map((t, k) => (
                    <option key={t.name} value={k}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label={`Item ${i + 1} hidden supply`}
                  inputMode="numeric"
                  value={it.count}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, count: e.target.value.replace(/\D/g, "") } : x)))}
                />
                <Button size="icon" variant="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
        <div className="glass glow-border space-y-4 rounded-2xl p-5">
          <h2 className="flex items-center gap-3 font-semibold"><span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[var(--sec-a)] to-[var(--sec-b)] text-sm font-bold text-[#140f33] shadow-[0_0_18px_-4px_var(--sec-a)]">3</span>Review &amp; launch</h2>
          <OddsBars tierTotals={totals} totalSupply={supply} proven={false} compact />
          <p className="text-sm text-muted-foreground">
            {supply.toLocaleString()} boxes · {amounts ? formatNight(amounts.p) : "—"} each · bond {amounts ? formatNight(amounts.b) : "—"}
          </p>
          {errors.length > 0 && (
            <ul className="space-y-1 text-xs text-rose-300">
              {errors.slice(0, 4).map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
          <Button className="btn-glow h-11 w-full rounded-xl font-semibold" disabled={errors.length > 0 || launching || tx.busy} onClick={launch}>
            {launching ? <Loader2 className="animate-spin" /> : <Rocket />} Launch drop
          </Button>
          <p className="text-xs text-muted-foreground">You'll approve about 7 transactions in your wallet. Keep this tab open until the steps finish.</p>
        </div>
        {progress && <LaunchSteps progress={progress} />}
      </aside>
    </div>
  );
}

function LaunchSteps({ progress }: { progress: CreateProgress }) {
  const order = ["deploying", "installing", "committingTable", "committingSeed", "registering", "done"] as const;
  const at = progress.step === "deployed" ? 1 : progress.step === "installed" ? 2 : order.indexOf(progress.step as (typeof order)[number]);
  const labels = [
    "Deploy the drop contract",
    progress.step === "installing" ? `Install circuits (${progress.done}/${progress.total})` : "Install the remaining circuits",
    "Commit hidden table, prove odds, post bond",
    "Commit the master seed",
    "List in the registry",
  ];
  return (
    <div className="glass rounded-2xl p-5">
      <ol className="space-y-2">
        {labels.map((l, i) => (
          <li key={l} className="flex items-center gap-2 text-sm">
            {i < at ? (
              <Check className="size-4 text-emerald-400" />
            ) : i === at ? (
              <Loader2 className="size-4 animate-spin sec-text" />
            ) : (
              <Circle className="size-4 text-muted-foreground" />
            )}
            <span className={i <= at ? "" : "text-muted-foreground"}>{l}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ─── Manage ─────────────────────────────────────────────────────────────────

function ManageDrops() {
  const drops = myDrops();
  if (drops.length === 0) {
    return (
      <Empty icon={<Rocket className="size-8" />} title="You haven't launched a drop from this browser">
        Create one in the New drop tab.
      </Empty>
    );
  }
  return (
    <div className="space-y-4">
      {drops.map((a) => (
        <ManagedDrop key={a} address={a} />
      ))}
    </div>
  );
}

function ManagedDrop({ address }: { address: string }) {
  const { data: drop } = useDrop(address);
  const holder = useHolder(address, drop);
  const { providers, providersFor } = useMidnightProviders();
  const tx = useTx();
  const now = useNow();
  if (!drop) {
    return (
      <div className="glass rounded-2xl p-5 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline size-4 animate-spin" /> Waiting for {address.slice(0, 10)}… to appear on chain
      </div>
    );
  }
  const isPublisher = !!holder.state?.publisher && toHex(pureCircuits.publisherKey(holder.state.publisher.secret)) === toHex(drop.publisherPk);
  const phase = phaseOf(drop, now);
  const queue = pendingQueue(drop);
  const launching = drop.state === DROP_STATE.SETUP || drop.state === DROP_STATE.TABLE_COMMITTED;
  const canReveal = drop.state === DROP_STATE.LIVE && (now >= Number(drop.saleEnd) || drop.requestCount === drop.totalSupply) && queue.length === 0;
  const revealReason =
    drop.state !== DROP_STATE.LIVE
      ? "Only a live drop can be revealed."
      : queue.length > 0
        ? "Open every requested box first."
        : `Available when the sale ends (${relativeTime(Number(drop.saleEnd), now)}) or sells out.`;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href={hrefFor({ name: "drop", address })} className="text-lg font-semibold hover:underline">
            {decodeText32(drop.title)}
          </a>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <Chip tone={phase === "defaulted" ? "bad" : phase === "live" ? "good" : "neutral"}>{PHASE_LABEL[phase]}</Chip>
            <Chip tone="neutral">
              {drop.openedCount.toString()} opened · {queue.length} waiting · {drop.requestCount.toString()}/{drop.totalSupply.toString()} sold
            </Chip>
            {!isPublisher && <Chip tone="bad">Publisher secrets not in this browser</Chip>}
          </div>
        </div>
        <a href={hrefFor({ name: "audit", address })} className="inline-flex items-center gap-1 text-sm sec-text hover:underline">
          <Eye className="size-4" /> Audit
        </a>
      </div>
      {isPublisher && providers && (
        <div className="mt-4 flex flex-wrap gap-2">
          {launching && providersFor && (
            <Button
              disabled={tx.busy}
              onClick={async () => {
                const reg = await providersFor<RegistryCircuits>(REGISTRY_ZK_PATH);
                await tx.run("Finishing launch", () => resumeDrop(providers, reg, address, () => {}), () => "Launch complete.");
              }}
            >
              <Rocket /> Finish launch
            </Button>
          )}
          {!launching && (
            <ResumeInstall address={address} />
          )}
          {queue.length > 0 && (
            <Button
              disabled={tx.busy}
              onClick={() => void tx.run("Opening the next box", () => openNextBox(providers, address), () => "Box opened and delivered.")}
            >
              Open next box (#{((queue[0]?.id ?? 0n) + 1n).toString()})
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={tx.busy || drop.publisherClaimable === 0n}
            title={drop.publisherClaimable === 0n ? "Nothing to claim yet" : undefined}
            onClick={() => void tx.run("Claiming proceeds", () => claimProceeds(providers, address), () => `${formatNight(drop.publisherClaimable)} sent to you.`)}
          >
            <Coins /> Claim {formatNight(drop.publisherClaimable)}
          </Button>
          <Button
            variant="secondary"
            disabled={tx.busy || !canReveal}
            title={canReveal ? undefined : revealReason}
            onClick={() => void tx.run("Revealing the table", () => finalReveal(providers, address), () => "Table revealed. Anyone can now audit the drop.")}
          >
            <Eye /> Final reveal
          </Button>
        </div>
      )}
      {isPublisher && !canReveal && drop.state === DROP_STATE.LIVE && <p className="mt-2 text-xs text-muted-foreground">Final reveal: {revealReason}</p>}
      {isPublisher && (
        <p className="mt-3 text-xs text-muted-foreground">
          Run the fulfiller service to open boxes automatically: export your publisher backup from the Vault and follow fulfiller/README.md.
        </p>
      )}
    </div>
  );
}

/** Shown only when a staged deploy stopped before every circuit was installed. */
function ResumeInstall({ address }: { address: string }) {
  const { providers, providersFor } = useMidnightProviders();
  const tx = useTx();
  const [complete, setComplete] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void dropIsComplete(address).then(
      (c) => alive && setComplete(c),
      () => alive && setComplete(null),
    );
    return () => {
      alive = false;
    };
  }, [address]);
  if (complete !== false || !providers || !providersFor) return null;
  return (
    <Button
      disabled={tx.busy}
      onClick={async () => {
        const reg = await providersFor<RegistryCircuits>(REGISTRY_ZK_PATH);
        const ok = await tx.run("Installing remaining circuits", () => resumeDrop(providers, reg, address, () => {}), () => "All circuits installed.");
        if (ok !== null) setComplete(true);
      }}
    >
      Install remaining circuits
    </Button>
  );
}
