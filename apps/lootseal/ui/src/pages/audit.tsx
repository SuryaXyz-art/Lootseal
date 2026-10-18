// SPDX-License-Identifier: Apache-2.0
// Public audit and badge verification. No wallet needed to read; verifying
// the odds on chain is one optional transaction anyone can send.
import { BadgeCheck, CheckCircle2, CircleDashed, EyeOff, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemArt, OddsBars, TierBadge } from "@/components/loot";
import { Empty, PageTitle, Spinner } from "@/components/shell";
import { useDrop } from "@/hooks/use-lootseal";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useWallet } from "@/hooks/use-wallet";
import { useTx } from "@/providers/tx-context";
import { verifyOdds, type DropLedger } from "@/midnight/lootseal-api";
import { badgeOf, catalogOf, DROP_STATE, oddsProven, topLabel, trustRecord } from "@/lib/drop-view";
import { formatPercent, decodeText32, sumByTier, tierOdds } from "../../../contract/lib.js";
import { toHex } from "../../../contract/witnesses.js";
import { TIER_STYLES, tierStyle } from "@/lib/art";
import { shortHex } from "@/lib/format";
import { hrefFor } from "@/router";

export function AuditPage({ address }: { address: string }) {
  const { data: drop, loading, error } = useDrop(address);
  if (loading && !drop) return <Spinner label="Reading the drop…" />;
  if (!drop) return <Empty icon={<EyeOff className="size-8" />} title="Drop not found">{error}</Empty>;
  return <Audit address={address} drop={drop} />;
}

type CheckState = "pass" | "fail" | "pending";

function Audit({ address, drop }: { address: string; drop: DropLedger }) {
  const { providers } = useMidnightProviders();
  const { status } = useWallet();
  const tx = useTx();
  const revealed = drop.state === DROP_STATE.REVEALED;
  const catalog = catalogOf(drop);
  const trust = trustRecord(drop);

  // Client-side re-checks of the revealed table (the same rules verifyOdds records on chain).
  const initialByTier = sumByTier(drop.revealedInitial, drop.catalogTiers);
  const remainingByTier = sumByTier(drop.revealedRemaining, drop.catalogTiers);
  const openedByTier = initialByTier.map((x, i) => x - (remainingByTier[i] ?? 0n));
  const openedTotal = openedByTier.reduce((a, b) => a + b, 0n);
  const oddsMatch = initialByTier.every((x, i) => x === drop.tierTotals[i]);
  const consistent = drop.revealedInitial.every((x, i) => x >= (drop.revealedRemaining[i] ?? 0n));
  const advertised = tierOdds(drop.tierTotals, drop.totalSupply);
  const at = (v: bigint[], i: number): bigint => v[i] ?? 0n;

  const checks: { title: string; state: CheckState; detail: string }[] = [
    {
      title: "Hidden table matches the advertised odds",
      state: oddsProven(drop) ? "pass" : "pending",
      detail: oddsProven(drop)
        ? "Proved in zero knowledge by commitTable before the sale opened. The per-item counts stayed secret."
        : "Runs when the publisher commits the table.",
    },
    {
      title: "Every draw used committed randomness",
      state: drop.state >= DROP_STATE.LIVE ? "pass" : "pending",
      detail: "openBox proves each item came from the committed seed, the buyer's seed and the hidden remaining supply.",
    },
    {
      title: "Boxes were opened on time",
      state: trust.refunded > 0 ? "fail" : trust.opened > 0 ? "pass" : "pending",
      detail: trust.refunded > 0 ? `${trust.refunded} late box(es) were refunded from the bond.` : `${trust.opened} box(es) opened within the window.`,
    },
    {
      title: "Revealed table equals the committed one",
      state: revealed ? (oddsMatch && consistent ? "pass" : "fail") : "pending",
      detail: revealed ? "finalReveal opened both commitments; this page re-checks the totals locally." : "Available after the publisher's final reveal.",
    },
    {
      title: "Verified on chain by an auditor",
      state: drop.oddsVerified ? "pass" : "pending",
      detail: drop.oddsVerified ? "verifyOdds recorded a passing audit on chain." : "Anyone can run verifyOdds once the table is revealed.",
    },
  ];

  return (
    <div>
      <PageTitle
        title={`Audit · ${decodeText32(drop.title)}`}
        subtitle="Everything Lootseal guarantees about this drop, checked from public chain data."
        actions={
          <a href={hrefFor({ name: "drop", address })} className="text-sm text-violet-300 hover:underline">
            Back to drop
          </a>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="glass rounded-2xl p-5">
            <ul className="space-y-3">
              {checks.map((c) => (
                <li key={c.title} className="flex gap-3">
                  {c.state === "pass" && <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />}
                  {c.state === "fail" && <XCircle className="mt-0.5 size-5 shrink-0 text-rose-400" />}
                  {c.state === "pending" && <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
                  <div>
                    <p className="text-sm font-medium">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {revealed && (
            <section className="glass rounded-2xl p-5">
              <h2 className="mb-1 font-semibold">Advertised vs. delivered</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Per tier: the advertised share of the drop, and what the {openedTotal.toString()} opened boxes actually contained.
              </p>
              <div className="space-y-3">
                {TIER_STYLES.map((t, i) =>
                  drop.tierTotals[i] === 0n ? null : (
                    <div key={t.name}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span style={{ color: t.color }}>{t.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          advertised {formatPercent(advertised[i] ?? 0)} · delivered{" "}
                          {openedTotal === 0n ? "—" : formatPercent((Number(at(openedByTier, i)) / Number(openedTotal)) * 100)}
                        </span>
                      </div>
                      <div className="relative h-2 rounded-full bg-white/5">
                        <div className="absolute inset-y-0 left-0 rounded-full opacity-40" style={{ width: `${advertised[i] ?? 0}%`, background: t.color }} />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${openedTotal === 0n ? 0 : (Number(at(openedByTier, i)) / Number(openedTotal)) * 100}%`, background: t.color, height: "50%", top: "25%" }}
                        />
                      </div>
                    </div>
                  ),
                )}
              </div>
              <h3 className="mb-2 mt-6 text-sm font-semibold">Revealed table</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-normal">Item</th>
                      <th className="py-1 font-normal">Tier</th>
                      <th className="py-1 text-right font-normal">Supply</th>
                      <th className="py-1 text-right font-normal">Opened</th>
                      <th className="py-1 text-right font-normal">Unsold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.map((c) => (
                      <tr key={c.itemType} className="border-t border-white/5">
                        <td className="flex items-center gap-2 py-1.5">
                          <ItemArt dropAddress={address} itemType={c.itemType} tier={c.tier} size={24} /> {c.name}
                        </td>
                        <td>
                          <TierBadge tier={c.tier} />
                        </td>
                        <td className="text-right tabular-nums">{at(drop.revealedInitial, c.itemType).toString()}</td>
                        <td className="text-right tabular-nums">{(at(drop.revealedInitial, c.itemType) - at(drop.revealedRemaining, c.itemType)).toString()}</td>
                        <td className="text-right tabular-nums">{at(drop.revealedRemaining, c.itemType).toString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <div className="glass rounded-2xl p-5">
            <OddsBars tierTotals={drop.tierTotals} totalSupply={drop.totalSupply} proven={oddsProven(drop)} />
          </div>
          <div className="glass space-y-2 rounded-2xl p-5 text-xs">
            <p className="text-sm font-semibold">Commitments</p>
            <Row k="Drop table" v={toHex(drop.tableCommit)} />
            <Row k="Remaining supply" v={toHex(drop.remainingCommit)} />
            <Row k="Master seed" v={toHex(drop.seedCommit)} />
            <Row k="Publisher key" v={toHex(drop.publisherPk)} />
            <p className="pt-2 text-muted-foreground">
              The master seed is never revealed, so nobody — including the publisher after the fact — can publish who received what.
            </p>
          </div>
          {revealed && (
            <div className="glass rounded-2xl p-5">
              <p className="text-sm font-semibold">Record the audit on chain</p>
              <p className="mt-1 text-xs text-muted-foreground">verifyOdds re-checks the revealed table inside a proof and stores the result.</p>
              <Button
                className="mt-3 w-full"
                disabled={tx.busy || !providers || drop.oddsVerified}
                title={status !== "connected" ? "Connect a wallet to send the transaction" : undefined}
                onClick={() => providers && void tx.run("Verifying odds on chain", () => verifyOdds(providers, address), () => "Audit recorded on chain.")}
              >
                <ShieldCheck /> {drop.oddsVerified ? "Already verified" : "Verify odds on chain"}
              </Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <code title={v}>{shortHex(v, 8, 6)}</code>
    </div>
  );
}

export function VerifyPage({ address, badge }: { address: string; badge: string }) {
  const { data: drop, loading } = useDrop(address);
  if (loading && !drop) return <Spinner label="Checking the badge on chain…" />;
  const b = drop ? badgeOf(drop, badge) : null;
  if (!drop || !b) {
    return (
      <Empty icon={<XCircle className="size-8 text-rose-400" />} title="No such badge">
        This rarity badge doesn't exist on this drop.
      </Empty>
    );
  }
  const style = tierStyle(b.maxTier);
  return (
    <div className="mx-auto max-w-lg">
      <div className="glass overflow-hidden rounded-3xl text-center" style={{ boxShadow: `0 0 60px -20px ${style.glow}` }}>
        <div className="grid place-items-center bg-gradient-to-b from-black/40 to-transparent p-8">
          <ItemArt dropAddress={address} itemType={b.maxTier} tier={b.maxTier} hidden size={160} />
        </div>
        <div className="space-y-3 p-6">
          <p className={`inline-flex items-center gap-2 text-sm font-medium ${b.current ? "text-emerald-300" : "text-amber-300"}`}>
            <BadgeCheck className="size-4" /> {b.current ? "Valid — held by the prover" : "Outdated — the item has moved since"}
          </p>
          <h1 className="text-2xl font-bold">
            {b.maxTier === 0 ? "Legendary" : b.maxTier === 4 ? "Genuine item" : `${style.name} or rarer`}
          </h1>
          <p className="text-muted-foreground">
            {topLabel(b.maxTier, drop)} of <a className="text-violet-300 hover:underline" href={hrefFor({ name: "drop", address })}>{decodeText32(drop.title)}</a>
          </p>
          <p className="text-xs text-muted-foreground">
            Proven in zero knowledge for “{b.context}”. The exact item and its serial stay private.
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">item {shortHex(b.itemId, 10, 8)}</p>
        </div>
      </div>
    </div>
  );
}
