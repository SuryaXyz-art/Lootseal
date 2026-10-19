// SPDX-License-Identifier: Apache-2.0
// Landing page: what Lootseal guarantees, who it is for, how a box opens,
// and every live drop.
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  Boxes,
  Dices,
  EyeOff,
  Fingerprint,
  Gavel,
  KeyRound,
  Palette,
  PackageOpen,
  ScrollText,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Store,
  Swords,
} from "lucide-react";
import { Link, type Route } from "@/router";
import { useDirectory, useNow, type DirectoryDrop } from "@/hooks/use-lootseal";
import { Empty, Spinner } from "@/components/shell";
import { ItemArt, OddsBars } from "@/components/loot";
import { SealedBox } from "@/components/box-opener";
import { Reveal } from "@/components/reveal";
import { DemoBox } from "@/components/demo-box";
import { catalogOf, oddsProven, phaseOf, PHASE_LABEL, trustRecord } from "@/lib/drop-view";
import { TIER_STYLES } from "@/lib/art";
import { formatNight, relativeTime } from "@/lib/format";
import { decodeText32 } from "../../../contract/lib.js";
import { cn } from "@/lib/utils";

/** Re-tints a block with its own colour pair (the .glass and helpers follow it). */
const tint = (a: string, b: string): CSSProperties => ({ "--sec-a": a, "--sec-b": b }) as CSSProperties;

const PILLARS = [
  {
    icon: ShieldCheck,
    title: "Odds proven at launch",
    body: "The hidden drop table is proven in zero knowledge to match the advertised odds before anyone buys.",
    a: "#f6c453",
    b: "#fb923c",
  },
  {
    icon: Shuffle,
    title: "Randomness nobody controls",
    body: "Each box is decided by a seed the publisher committed and a seed you pick. Neither side can steer it.",
    a: "#b18cff",
    b: "#f472b6",
  },
  {
    icon: EyeOff,
    title: "No sniping",
    body: "What's left in the drop stays hidden, so every box has exactly the advertised chance.",
    a: "#5cc8ff",
    b: "#818cf8",
  },
  {
    icon: Gavel,
    title: "Refunds are enforced",
    body: "Boxes open in order within a deadline, or you claim back your price plus a penalty from the publisher's bond.",
    a: "#4fd69c",
    b: "#22d3ee",
  },
];

const TICKER = [
  "Zero-knowledge odds",
  "Commit–reveal randomness",
  "Hidden remaining supply",
  "Encrypted item delivery",
  "FIFO opening with deadlines",
  "Bonded publishers",
  "Rarity proofs on resale",
  "Built on Midnight",
];

const STEPS = [
  { icon: ScrollText, title: "The publisher seals the table", body: "Odds proven, master seed committed, bond locked — all before the first sale." },
  { icon: Dices, title: "You add your own seed", body: "Your box is bought with a secret seed only you know. Nobody can predict the mix." },
  { icon: PackageOpen, title: "A proof opens your box", body: "The draw is computed inside a ZK proof, strictly in order, before the deadline." },
  { icon: KeyRound, title: "Your item arrives sealed", body: "Encrypted to your key inside the same proof. Only your browser can unseal it." },
];

const AUDIENCES: { icon: typeof Swords; who: string; pitch: string; points: string[]; cta: string; to: Route; a: string; b: string }[] = [
  {
    icon: Swords,
    who: "Players",
    pitch: "Open boxes knowing the odds are real.",
    points: ["Proven odds, not promises", "Refund + penalty if late", "Nobody sees what you pulled"],
    cta: "Browse drops",
    to: { name: "home" },
    a: "#a78bfa",
    b: "#f6c453",
  },
  {
    icon: Palette,
    who: "Creators & studios",
    pitch: "Launch a drop players can actually trust.",
    points: ["Hidden table, public proof", "Your secrets stay in your browser", "Unattended fulfiller service"],
    cta: "Open the Studio",
    to: { name: "studio" },
    a: "#e879f9",
    b: "#38bdf8",
  },
  {
    icon: Store,
    who: "Collectors & traders",
    pitch: "Trade items with rarity proven, not claimed.",
    points: ["Rarity proofs on every listing", "Escrow until delivery", "Private holdings in your Vault"],
    cta: "Visit the Bazaar",
    to: { name: "bazaar" },
    a: "#fbbf24",
    b: "#fb7185",
  },
  {
    icon: Fingerprint,
    who: "Auditors & regulators",
    pitch: "Check every guarantee from public chain data.",
    points: ["Advertised vs. delivered per tier", "On-chain audit record", "Shareable verification badges"],
    cta: "See how audits work",
    to: { name: "home" },
    a: "#34d399",
    b: "#22d3ee",
  },
];

export function HomePage() {
  const dir = useDirectory();
  const drops = dir.data ?? [];
  const sold = drops.reduce((n, d) => n + Number(d.ledger.requestCount), 0);
  const opened = drops.reduce((n, d) => n + trustRecord(d.ledger).opened, 0);
  return (
    <div className="space-y-24">
      <section className="glass glow-border relative overflow-hidden rounded-[2rem] px-6 py-12 sm:px-12 sm:py-16">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 animate-[aurora_14s_ease-in-out_infinite] rounded-full bg-violet-600/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-4 size-80 animate-[aurora_18s_ease-in-out_infinite_reverse] rounded-full bg-amber-500/15 blur-3xl" />
        <div className="relative grid items-center gap-12 md:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="eyebrow mb-5">
              <Sparkles className="size-3.5 animate-[twinkle_2s_ease-in-out_infinite]" /> Built on Midnight · zero-knowledge fairness
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.1] sm:text-6xl">
              Prove the odds were real.
              <br />
              <span className="text-gradient">Spoil no surprise.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Loot boxes and mystery mints where the drop table is proven fair, the draw can't be rigged, and your item is
              delivered to you, encrypted, inside the same proof.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={scrollToDrops} className="btn-glow inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold">
                Browse drops <ArrowRight className="size-4" />
              </button>
              <DemoBox className="btn-ghost-glow inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold" />
              <Link to={{ name: "studio" }} className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-muted-foreground hover:text-foreground">
                Launch a drop
              </Link>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">No wallet needed for the demo box.</p>
            {drops.length > 0 && (
              <dl className="mt-8 grid max-w-md grid-cols-3 gap-4">
                <HeroStat label="Live drops" value={drops.length.toLocaleString()} />
                <HeroStat label="Boxes sold" value={sold.toLocaleString()} />
                <HeroStat label="Boxes opened" value={opened.toLocaleString()} />
              </dl>
            )}
          </div>
          <HeroArt />
        </div>
      </section>

      <div className="marquee -mx-4 overflow-hidden py-1" aria-hidden="true">
        <div className="marquee-track flex w-max gap-3">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm text-muted-foreground"
            >
              <span className="size-1.5 rounded-full" style={{ background: TIER_STYLES[i % 4]!.color, boxShadow: `0 0 8px ${TIER_STYLES[i % 4]!.glow}` }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <section>
        <SectionHead eyebrow="The guarantees" title="Fairness you can check, not just trust" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 90}>
              <div className="glass tilt group h-full rounded-2xl p-6" style={tint(p.a, p.b)}>
                <div className="relative mb-4 grid size-12 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--sec-a)_16%,transparent)]">
                  <span className="absolute inset-0 rounded-xl opacity-0 shadow-[0_0_24px_var(--sec-a)] transition-opacity group-hover:opacity-100" />
                  <p.icon className="size-6" style={{ color: p.a }} />
                </div>
                <p className="font-[family-name:var(--font-display)] font-semibold">{p.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section>
        <SectionHead eyebrow="How a box opens" title="Four steps, one proof each" />
        <div className="relative grid gap-5 md:grid-cols-4">
          <div className="pointer-events-none absolute left-[12%] right-[12%] top-8 hidden h-px overflow-hidden bg-white/10 md:block">
            <div className="h-px w-1/4 animate-[beam_3.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-[var(--sec-b)] to-transparent" />
          </div>
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 120} className="relative text-center">
              <div className="relative mx-auto mb-4 grid size-16 place-items-center">
                <span
                  className="absolute inset-0 animate-[pulse-ring_3s_ease-out_infinite] rounded-full border border-[var(--sec-a)]"
                  style={{ animationDelay: `${i * 0.75}s` }}
                />
                <span className="grid size-16 place-items-center rounded-full border border-white/10 bg-[#0f0c26] shadow-[0_0_30px_-8px_var(--sec-a)]">
                  <s.icon className="size-7 sec-text" />
                </span>
                <span className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full bg-gradient-to-br from-[var(--sec-a)] to-[var(--sec-b)] text-xs font-bold text-[#140f33]">
                  {i + 1}
                </span>
              </div>
              <p className="font-[family-name:var(--font-display)] text-sm font-semibold">{s.title}</p>
              <p className="mx-auto mt-2 max-w-60 text-sm text-muted-foreground">{s.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section>
        <SectionHead eyebrow="Made for everyone in the loop" title="Whoever you are, the proof works for you" />
        <div className="grid gap-5 sm:grid-cols-2">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.who} delay={(i % 2) * 120}>
              <div className="glass glow-border glow-border-hover group relative h-full overflow-hidden rounded-2xl p-6" style={tint(a.a, a.b)}>
                <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-60" style={{ background: a.a }} />
                <div className="relative flex items-start gap-4">
                  <span
                    className="grid size-12 shrink-0 place-items-center rounded-xl"
                    style={{ background: `linear-gradient(135deg, ${a.a}, ${a.b})`, boxShadow: `0 10px 30px -10px ${a.a}` }}
                  >
                    <a.icon className="size-6 text-[#140f33]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: a.a }}>
                      {a.who}
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold leading-snug">{a.pitch}</p>
                    <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                      {a.points.map((pt) => (
                        <li key={pt} className="flex items-center gap-2">
                          <span className="size-1.5 rounded-full" style={{ background: a.b }} /> {pt}
                        </li>
                      ))}
                    </ul>
                    {a.who === "Players" || a.who === "Auditors & regulators" ? (
                      <button onClick={scrollToDrops} className="mt-4 inline-flex items-center gap-1 text-sm font-medium sec-text hover:gap-2 transition-all">
                        {a.cta} <ArrowRight className="size-4" />
                      </button>
                    ) : (
                      <Link to={a.to} className="mt-4 inline-flex items-center gap-1 text-sm font-medium sec-text hover:gap-2 transition-all">
                        {a.cta} <ArrowRight className="size-4" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="drops" className="scroll-mt-24">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">
              <Boxes className="size-3.5" /> On-chain registry
            </p>
            <h2 className="text-3xl font-bold">Drops</h2>
            <p className="mt-1 text-sm text-muted-foreground">Every drop listed in the on-chain registry and verified against its contract.</p>
          </div>
          <button onClick={dir.reload} className="btn-ghost-glow rounded-lg px-3 py-1.5 text-sm sec-text">
            Refresh
          </button>
        </div>
        {dir.loading && !dir.data && <Spinner label="Reading the registry…" />}
        {dir.error && <p className="text-sm text-rose-300">{dir.error}</p>}
        {dir.data && dir.data.length === 0 && (
          <Empty icon={<Boxes className="size-8" />} title="No drops yet">
            Be the first: <Link to={{ name: "studio" }} className="sec-text hover:underline">launch a drop in the Studio</Link>.
            <div className="mt-4">
              <DemoBox className="btn-glow inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold" label="Meanwhile, open a demo box" />
            </div>
          </Empty>
        )}
        {dir.data && dir.data.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {dir.data.map((d, i) => (
              <Reveal key={d.address} delay={(i % 3) * 100}>
                <DropCard drop={d} />
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <Reveal>
        <section className="glass glow-border relative overflow-hidden rounded-[2rem] px-6 py-12 text-center sm:px-12" style={tint("#f472b6", "#f6c453")}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--sec-a)_18%,transparent),transparent_70%)]" />
          <div className="relative mx-auto mb-6 w-fit animate-[float_5s_ease-in-out_infinite]">
            <SealedBox size={110} />
          </div>
          <h2 className="relative text-2xl font-bold sm:text-4xl">
            Every box sealed. <span className="text-gradient">Every odd proven.</span>
          </h2>
          <p className="relative mx-auto mt-3 max-w-xl text-muted-foreground">
            Run a drop your community can audit, or open a box knowing exactly what chance you had.
          </p>
          <div className="relative mt-7 flex flex-wrap justify-center gap-3">
            <Link to={{ name: "studio" }} className="btn-glow inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold">
              Launch a drop <ArrowRight className="size-4" />
            </Link>
            <DemoBox className="btn-ghost-glow inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold" />
          </div>
        </section>
      </Reveal>
    </div>
  );
}

/** The router owns the URL hash, so in-page jumps scroll instead of linking to "#drops". */
function scrollToDrops() {
  document.getElementById("drops")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <Reveal className="mb-8 text-center">
      <p className="eyebrow mb-3">{eyebrow}</p>
      <h2 className="mx-auto max-w-2xl text-2xl font-bold sm:text-4xl">{title}</h2>
    </Reveal>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-gradient font-[family-name:var(--font-display)] text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** The sealed box, circled by the five tiers' gems and pulsing seal rings. */
function HeroArt() {
  return (
    <div className="relative mx-auto grid size-[300px] place-items-center sm:size-[360px]" aria-hidden="true">
      <div className="absolute inset-6 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.35),transparent_65%)] blur-xl" />
      <span className="absolute inset-[22%] animate-[pulse-ring_3.2s_ease-out_infinite] rounded-full border border-violet-300/60" />
      <span className="absolute inset-[22%] animate-[pulse-ring_3.2s_ease-out_1.6s_infinite] rounded-full border border-amber-300/50" />
      <div className="absolute inset-0 animate-[spin-slow_40s_linear_infinite] rounded-full border border-dashed border-white/10">
        {TIER_STYLES.map((t, i) => {
          const angle = (i / TIER_STYLES.length) * Math.PI * 2;
          return (
            <span
              key={t.name}
              className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px]"
              style={{
                left: `${50 + 50 * Math.cos(angle)}%`,
                top: `${50 + 50 * Math.sin(angle)}%`,
                background: `linear-gradient(135deg, #fff, ${t.color})`,
                boxShadow: `0 0 16px ${t.glow}, 0 0 4px ${t.color}`,
              }}
            />
          );
        })}
      </div>
      <div className="absolute inset-[12%] animate-[spin-rev_28s_linear_infinite] rounded-full border border-white/5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Sparkles
            key={i}
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 animate-[twinkle_2.4s_ease-in-out_infinite] text-amber-200"
            style={{
              left: `${50 + 50 * Math.cos((i * Math.PI) / 3)}%`,
              top: `${50 + 50 * Math.sin((i * Math.PI) / 3)}%`,
              animationDelay: `${i * 0.4}s`,
            }}
          />
        ))}
      </div>
      <div className="relative animate-[float_5s_ease-in-out_infinite] drop-shadow-[0_20px_40px_rgba(139,92,246,0.45)]">
        <SealedBox size={220} />
      </div>
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
    <Link
      to={{ name: "drop", address: drop.address }}
      className="glass glow-border glow-border-hover tilt group block overflow-hidden rounded-2xl"
    >
      <div className="relative flex gap-1 overflow-hidden bg-black/30 p-3">
        {items.slice(0, 5).map((it) => (
          <ItemArt
            key={it.itemType}
            dropAddress={drop.address}
            itemType={it.itemType}
            tier={it.tier}
            size={64}
            className="transition-transform duration-500 group-hover:-translate-y-1"
          />
        ))}
        <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-[family-name:var(--font-display)] text-lg font-semibold">{decodeText32(l.title)}</p>
            <p className="text-sm text-muted-foreground">
              {formatNight(l.price)} per box · {items.length} items
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              phase === "live" && "bg-emerald-500/15 text-emerald-300",
              phase === "defaulted" && "bg-rose-500/15 text-rose-300",
              phase === "revealed" && "bg-violet-500/15 text-violet-200",
              (phase === "soldOut" || phase === "ended" || phase === "setup") && "bg-white/10 text-muted-foreground",
            )}
          >
            {phase === "live" && <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />}
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
            <div className="progress-shine h-full rounded-full" style={{ width: `${(sold / Math.max(total, 1)) * 100}%` }} />
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

export function Chip({ tone, children }: { tone: "good" | "bad" | "neutral"; children: ReactNode }) {
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
