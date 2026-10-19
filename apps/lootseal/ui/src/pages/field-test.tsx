// SPDX-License-Identifier: Apache-2.0
// The field test: Lootseal used by real identities on the Preview network,
// every step checked against the chain (scripts/field-test.ts). This page
// shows the journal and re-checks each transaction on the public indexer
// from the visitor's own browser.
import { useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, CircleDashed, Eye, Link2, Loader2, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, PageTitle } from "@/components/shell";
import { config } from "@/config";
import { byScenario, fieldJournal, pool, proveOnChain, summarize, type ChainProof, type FieldCheck } from "@/lib/field-journal";
import { shortHex } from "@/lib/format";
import { hrefFor } from "@/router";

const EXPECT_LABEL: Record<FieldCheck["expect"], string> = {
  accepted: "transaction",
  rejected: "attack refused",
  verified: "chain check",
};

export function FieldTestPage() {
  const j = fieldJournal;
  const s = useMemo(() => summarize(j), [j]);
  const groups = useMemo(() => byScenario(j), [j]);
  const [proofs, setProofs] = useState<Record<string, ChainProof | "checking">>({});
  const [running, setRunning] = useState(false);

  const recheck = async () => {
    setRunning(true);
    const txs = j.checks.filter((c) => c.tx);
    setProofs(Object.fromEntries(txs.map((c) => [c.key, "checking" as const])));
    await pool(txs, 4, async (c) => {
      const p = await proveOnChain(config.indexerUri, c);
      setProofs((prev) => ({ ...prev, [c.key]: p }));
    });
    setRunning(false);
  };

  useEffect(() => {
    if (j.checks.some((c) => c.tx)) void recheck();
    // Re-check once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmed = Object.values(proofs).filter((p) => p !== "checking" && p.state === "ok").length;

  if (j.checks.length === 0) {
    return (
      <Empty icon={<CircleDashed className="size-8" />} title="No field test recorded yet">
        Run <code>yarn field-test</code> against a network to record one.
      </Empty>
    );
  }

  return (
    <div>
      <PageTitle
        title="Field test"
        subtitle={
          <>
            Lootseal used by {s.actors} separate identities on Midnight {j.network}: buying, opening, decrypting, proving, gifting, trading,
            refunding and auditing, plus attacks that the contract must refuse. Every transaction below is re-checked live against the public
            indexer from your browser.
          </>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => void recheck()} disabled={running}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Re-check on chain
          </Button>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="checks passed" value={`${s.passed}/${s.total}`} good={s.passed === s.total} />
        <Stat label="real transactions" value={String(s.transactions)} />
        <Stat label="confirmed live" value={running ? `${confirmed}…` : `${confirmed}/${s.transactions}`} good={!running && confirmed === s.transactions} />
        <Stat label="attacks refused" value={String(s.refused)} />
        <Stat label="circuits exercised" value={String(s.circuits)} />
        <Stat label="drops" value={String(s.drops)} />
      </div>

      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {Object.entries(j.drops).map(([address, d]) => (
          <a key={address} href={hrefFor({ name: "audit", address })} className="glass rounded-2xl p-4 transition hover:bg-white/5">
            <p className="font-semibold">{d.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{d.story}</p>
            <p className="mt-2 font-mono text-[11px] sec-text">{shortHex(address, 10, 6)} · audit →</p>
          </a>
        ))}
      </div>

      <div className="space-y-8">
        {groups.map(([scenario, checks]) => (
          <section key={scenario} className="glass rounded-2xl p-5">
            <h2 className="mb-4 font-semibold">{scenario}</h2>
            <ol className="space-y-3">
              {checks.map((c) => (
                <Row key={c.key} c={c} proof={proofs[c.key]} />
              ))}
            </ol>
          </section>
        ))}
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Recorded {new Date(j.startedAt).toLocaleString()} – {new Date(j.updatedAt).toLocaleString()}
        {s.firstBlock !== null && ` · blocks ${s.firstBlock.toLocaleString()}–${s.lastBlock!.toLocaleString()}`}. One funded wallet pays the
        network fees; each player holds their own keys and private state, so the chain sees separate, unlinkable owners. Who pulled which item
        stays private: the journal records only what is public on chain, plus a ✓ for each player decrypting their own deliveries.
      </p>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className={`font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums ${good ? "text-emerald-300" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({ c, proof }: { c: FieldCheck; proof: ChainProof | "checking" | undefined }) {
  const icon =
    c.result === "fail" ? (
      <XCircle className="size-5 text-rose-400" />
    ) : c.expect === "rejected" ? (
      <ShieldX className="size-5 text-amber-300" />
    ) : c.expect === "verified" ? (
      <Eye className="size-5 text-sky-300" />
    ) : (
      <CheckCircle2 className="size-5 text-emerald-400" />
    );
  return (
    <li className="flex gap-3 border-b border-white/5 pb-3 last:border-0 last:pb-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="mr-2 text-xs tabular-nums text-muted-foreground">#{c.n}</span>
          <span className="font-medium capitalize">{c.actor}</span> · {c.action}
          {c.circuit && <code className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-muted-foreground">{c.circuit}</code>}
        </p>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{c.detail}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className={c.expect === "rejected" ? "text-amber-300/90" : ""}>
            {c.expect === "rejected" && <Ban className="mr-1 inline size-3" />}
            {EXPECT_LABEL[c.expect]}
          </span>
          {c.tx && (
            <span className="font-mono" title={c.tx.hash}>
              <Link2 className="mr-1 inline size-3" />
              tx {shortHex(c.tx.hash, 8, 6)} · block {c.tx.blockHeight.toLocaleString()}
            </span>
          )}
          {c.tx && <ProofTag proof={proof} />}
          <span>{c.seconds}s</span>
        </div>
      </div>
    </li>
  );
}

function ProofTag({ proof }: { proof: ChainProof | "checking" | undefined }) {
  if (!proof) return null;
  if (proof === "checking") return <span className="text-muted-foreground">checking indexer…</span>;
  if (proof.state === "ok") return <span className="text-emerald-300">✓ on chain ({proof.status.toLowerCase()})</span>;
  return <span className="text-rose-300">✗ {proof.reason}</span>;
}
