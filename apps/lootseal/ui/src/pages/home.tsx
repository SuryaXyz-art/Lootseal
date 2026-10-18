// SPDX-License-Identifier: Apache-2.0
// Landing page: what Lootseal guarantees, and every live drop.
import { Boxes, EyeOff, Gavel, ShieldCheck, Shuffle, Sparkles } from "lucide-react";
import { Link } from "@/router";
import { useDirectory, useNow, type DirectoryDrop } from "@/hooks/use-lootseal";
import { Empty, Spinner } from "@/components/shell";
import { ItemArt, OddsBars } from "@/components/loot";
import { SealedBox } from "@/components/box-opener";
import { catalogOf, oddsProven, phaseOf, PHASE_LABEL, trustRecord } from "@/lib/drop-view";
import { formatNight, relativeTime } from "@/lib/format";
import { decodeText32 } from "../../../contract/lib.js";
import { cn } from "@/lib/utils";

const PILLARS = [
  { icon: ShieldCheck, title: "Odds proven at launch", body: "The hidden drop table is proven in zero knowledge to match the advertised odds before anyone buys." },
  { icon: Shuffle, title: "Randomness nobody controls", body: "Each box is decided by a seed the publisher committed and a seed you pick. Neither side can steer it." },
  { icon: EyeOff, title: "No sniping", body: "What's left in the drop stays hidden, so every box has exactly the advertised chance." },
  { icon: Gavel, title: "Refunds are enforced", body: "Boxes open in order within a deadline, or you claim back your price plus a penalty from the publisher's bond." },
];

export function HomePage() {
  const dir = useDirectory();
  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-br from-violet-950/60 via-[#0c0a1d] to-[#07060f] px-6 py-12 sm:px-12 sm:py-16">
        <div className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-10 size-72 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative grid items-center gap-10 md:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
              <Sparkles className="size-3.5" /> Built on Midnight · zero-knowledge fairness
            </p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Prove the odds were real.
              <br />
              <span className="bg-gradient-to-r from-violet-300 to-amber-300 bg-clip-text text-transparent">Spoil no surprise.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Loot boxes and mystery mints where the drop table is proven fair, the draw can't be rigged, and your item is
              delivered to you, encrypted, inside the same proof.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#drops" className="rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 hover:bg-violet-400">
                Browse drops
              </a>
              <Link to={{ name: "studio" }} className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold hover:bg-white/5">
                Launch a drop
              </Link>
            </div>
          </div>
          <div className="relative mx-auto grid place-items-center">
            <div className="absolute size-64 rounded-full bg-violet-500/20 blur-2xl" />
            <div className="animate-[float_5s_ease-in-out_infinite]">
              <SealedBox size={240} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map((p) => (
          <div key={p.title} className="glass rounded-2xl p-5">
            <p.icon className="mb-3 size-6 text-violet-300" />
            <p className="font-semibold">{p.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </section>

      <section id="drops" className="scroll-mt-24">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold">Drops</h2>
            <p className="text-sm text-muted-foreground">Every drop listed in the on-chain registry and verified against its contract.</p>
          </div>
          <button onClick={dir.reload} className="text-sm text-violet-300 hover:underline">
            Refresh
          </button>
        </div>
        {dir.loading && !dir.data && <Spinner label="Reading the registry…" />}
        {dir.error && <p className="text-sm text-rose-300">{dir.error}</p>}
        {dir.data && dir.data.length === 0 && (
          <Empty icon={<Boxes className="size-8" />} title="No drops yet">
            Be the first: <Link to={{ name: "studio" }} className="text-violet-300 hover:underline">launch a drop in the Studio</Link>.
          </Empty>
        )}
        {dir.data && dir.data.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {dir.data.map((d) => (
              <DropCard key={d.address} drop={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DropCard({ drop }: { drop: DirectoryDrop }) {
  const now = useNow(30_000);
  const l = drop.ledger;
  const phase = phaseOf(l, now);
  const items = catalogOf(l);
  const trust = trustRecord(l);
  const sold = Number(l.requestCount);
  const total = Number(l.totalSupply);
  return (
    <Link to={{ name: "drop", address: drop.address }} className="glass group block overflow-hidden rounded-2xl transition-transform hover:-translate-y-1">
      <div className="flex gap-1 overflow-hidden bg-black/30 p-3">
        {items.slice(0, 5).map((it) => (
          <ItemArt key={it.itemType} dropAddress={drop.address} itemType={it.itemType} tier={it.tier} size={64} />
        ))}
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{decodeText32(l.title)}</p>
            <p className="text-sm text-muted-foreground">
              {formatNight(l.price)} per box · {items.length} items
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              phase === "live" && "bg-emerald-500/15 text-emerald-300",
              phase === "defaulted" && "bg-rose-500/15 text-rose-300",
              phase === "revealed" && "bg-violet-500/15 text-violet-200",
              (phase === "soldOut" || phase === "ended" || phase === "setup") && "bg-white/10 text-muted-foreground",
            )}
          >
            {PHASE_LABEL[phase]}
          </span>
        </div>
        <OddsBars tierTotals={l.tierTotals} totalSupply={l.totalSupply} proven={oddsProven(l)} compact />
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>
              {sold.toLocaleString()} / {total.toLocaleString()} boxes sold
            </span>
            {phase === "live" && <span>ends {relativeTime(Number(l.saleEnd), now)}</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-amber-400" style={{ width: `${(sold / Math.max(total, 1)) * 100}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {oddsProven(l) && <Chip tone="good">Odds proven ✓</Chip>}
          {drop.verified && <Chip tone="good">Registry verified</Chip>}
          {trust.onTimeRate !== null && (
            <Chip tone={trust.refunded > 0 ? "bad" : "good"}>On-time opens {Math.round(trust.onTimeRate * 100)}%</Chip>
          )}
          {l.oddsVerified && <Chip tone="good">Audit passed</Chip>}
        </div>
      </div>
    </Link>
  );
}

export function Chip({ tone, children }: { tone: "good" | "bad" | "neutral"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        tone === "bad" && "border-rose-500/30 bg-rose-500/10 text-rose-300",
        tone === "neutral" && "border-white/10 bg-white/5 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
