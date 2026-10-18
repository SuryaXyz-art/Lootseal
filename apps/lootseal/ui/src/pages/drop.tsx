// SPDX-License-Identifier: Apache-2.0
// One drop: catalog, proven odds, buying a box, waiting for the sealed draw,
// the reveal, refunds, and (for the publisher) the opening queue.
import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, EyeOff, FileSearch, Loader2, Lock, PackageOpen, ShieldCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { BoxOpener, SealedBox } from "@/components/box-opener";
import { ItemArt, OddsBars, TierBadge } from "@/components/loot";
import { Empty, Spinner, WalletGate } from "@/components/shell";
import { Chip } from "@/pages/home";
import { useDrop, useHolder, useNow } from "@/hooks/use-lootseal";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useWallet } from "@/hooks/use-wallet";
import { useTx } from "@/providers/tx-context";
import { buyBox, claimRefund, openNextBox, rememberMyDrop, type DropLedger } from "@/midnight/lootseal-api";
import { pureCircuits } from "@/midnight/contract";
import { walletUserAddress } from "@/lib/addresses";
import {
  catalogOf,
  myRequests,
  oddsProven,
  pendingQueue,
  phaseOf,
  PHASE_LABEL,
  REQUEST_STATUS,
  topLabel,
  trustRecord,
} from "@/lib/drop-view";
import { formatNight, relativeTime, shortHex } from "@/lib/format";
import { Link } from "@/router";
import { decodeText32 } from "../../../contract/lib.js";
import { toHex } from "../../../contract/witnesses.js";

const SEEN_KEY = "lootseal:revealed";

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function markSeen(id: string) {
  try {
    const s = seen();
    s.add(id);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export function DropPage({ address }: { address: string }) {
  const { data: drop, loading, error } = useDrop(address);
  if (loading && !drop) return <Spinner label="Reading the drop from Midnight…" />;
  if (error || !drop) {
    return (
      <Empty icon={<EyeOff className="size-8" />} title="Drop not found">
        {error ?? "Check the address and network."}
      </Empty>
    );
  }
  return <DropView address={address} drop={drop} />;
}

function DropView({ address, drop }: { address: string; drop: DropLedger }) {
  const now = useNow();
  const phase = phaseOf(drop, now);
  const catalog = useMemo(() => catalogOf(drop), [drop]);
  const trust = trustRecord(drop);
  const sold = Number(drop.requestCount);
  const total = Number(drop.totalSupply);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip tone={phase === "live" ? "good" : phase === "defaulted" ? "bad" : "neutral"}>{PHASE_LABEL[phase]}</Chip>
            {oddsProven(drop) && <Chip tone="good">Odds proven ✓</Chip>}
            {drop.oddsVerified && <Chip tone="good">Audit passed ✓</Chip>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{decodeText32(drop.title)}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground" title={address}>
            {shortHex(address, 10, 8)}
          </p>
        </div>
        <div className="glass grid grid-cols-3 gap-6 rounded-2xl px-6 py-4 text-center">
          <Stat label="Price" value={formatNight(drop.price)} />
          <Stat label="Sold" value={`${sold.toLocaleString()} / ${total.toLocaleString()}`} />
          <Stat label={now < Number(drop.saleEnd) ? "Ends" : "Ended"} value={relativeTime(Number(drop.saleEnd), now)} />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          <section className="glass rounded-2xl p-5">
            <OddsBars tierTotals={drop.tierTotals} totalSupply={drop.totalSupply} proven={oddsProven(drop)} />
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-violet-400/20 bg-violet-500/5 p-3 text-sm">
              <Lock className="mt-0.5 size-4 shrink-0 text-violet-300" />
              <p className="text-muted-foreground">
                <span className="text-foreground">What's left in the drop is hidden, by design.</span> Nobody — not bots, not insiders,
                not you — can see which items remain, so every box carries exactly the advertised odds and there is nothing to snipe.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">What's inside</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {catalog.map((it) => (
                <div key={it.itemType} className="glass rounded-xl p-2">
                  <ItemArt dropAddress={address} itemType={it.itemType} tier={it.tier} size={160} className="h-auto w-full" />
                  <p className="mt-2 truncate text-sm font-medium">{it.name}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <TierBadge tier={it.tier} />
                    <span className="text-[11px] text-muted-foreground">{topLabel(it.tier, drop)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass rounded-2xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Trust record</h2>
              <Link to={{ name: "audit", address }} className="inline-flex items-center gap-1 text-sm text-violet-300 hover:underline">
                <FileSearch className="size-4" /> Full audit
              </Link>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <Fact label="Boxes opened" value={trust.opened.toLocaleString()} />
              <Fact label="Late boxes refunded" value={trust.refunded.toLocaleString()} bad={trust.refunded > 0} />
              <Fact label="Publisher bond left" value={formatNight(drop.bondRemaining)} />
              <Fact label="Fulfillment window" value={`${Math.round(Number(drop.fulfillWindow) / 60)} min`} />
              <Fact label="Refund penalty" value={formatNight(drop.penaltyPerBox)} />
              <Fact label="Table commitment" value={shortHex(toHex(drop.tableCommit), 8, 6)} mono />
            </dl>
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <BuyPanel address={address} drop={drop} phase={phase} />
        </aside>
      </div>
    </div>
  );
}

function BuyPanel({ address, drop, phase }: { address: string; drop: DropLedger; phase: ReturnType<typeof phaseOf> }) {
  const now = useNow();
  const { connectedApi, networkId } = useWallet();
  const { providers } = useMidnightProviders();
  const holder = useHolder(address, drop);
  const tx = useTx();
  const [reveal, setReveal] = useState<null | { itemId: string; itemType: number; serial: bigint }>(null);
  const announced = useRef<Set<string>>(seen());

  const mine = myRequests(drop, holder.ownerKey);
  const catalog = catalogOf(drop);
  const queue = pendingQueue(drop);

  // Reveal each newly opened box of mine exactly once.
  useEffect(() => {
    if (!holder.state) return;
    for (const r of mine) {
      if (r.status !== REQUEST_STATUS.OPENED) continue;
      const itemId = toHex(pureCircuits.itemIdOf(r.id));
      const op = holder.state.items[itemId];
      if (op && !announced.current.has(itemId)) {
        announced.current.add(itemId);
        markSeen(itemId);
        setReveal({ itemId, itemType: Number(op.itemType), serial: op.serial });
        break;
      }
    }
  }, [mine, holder.state]);

  const doBuy = async () => {
    if (!providers || !connectedApi || !networkId) return;
    rememberMyDrop(address);
    const refundTo = await walletUserAddress(connectedApi, networkId);
    await tx.run("Opening a box", () => buyBox(providers, address, refundTo), () => "Your box is sealed. It opens as soon as the publisher's proof lands.");
    await holder.refresh();
  };

  const revealed = reveal && catalog.find((c) => c.itemType === reveal.itemType);

  return (
    <>
      <div className="glass overflow-hidden rounded-2xl">
        <div className="grid place-items-center bg-gradient-to-b from-violet-950/50 to-transparent pb-2 pt-6">
          <div className={phase === "live" ? "animate-[float_5s_ease-in-out_infinite]" : "opacity-60 grayscale"}>
            <SealedBox size={150} />
          </div>
        </div>
        <div className="space-y-4 p-5">
          {phase === "live" ? (
            <WalletGate reason="to open a box">
              <Button className="h-12 w-full bg-violet-500 text-base font-semibold text-white hover:bg-violet-400" disabled={tx.busy} onClick={doBuy}>
                {tx.busy ? <Loader2 className="animate-spin" /> : <PackageOpen />} Open a box · {formatNight(drop.price)}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Paid in NIGHT. If the publisher doesn't open it within {Math.round(Number(drop.fulfillWindow) / 60)} minutes, you can claim a refund plus{" "}
                {formatNight(drop.penaltyPerBox)}.
              </p>
            </WalletGate>
          ) : (
            <p className="rounded-xl bg-white/5 p-3 text-center text-sm text-muted-foreground">
              {phase === "setup" && "This drop is still launching."}
              {phase === "soldOut" && "Sold out — every box has been bought."}
              {phase === "ended" && "The sale has ended."}
              {phase === "defaulted" && "The publisher missed a deadline. Sales are closed and late boxes can be refunded."}
              {phase === "revealed" && "The sale is over and the drop table has been revealed."}
            </p>
          )}
          {holder.error && <p className="text-xs text-rose-300">{holder.error}</p>}
        </div>
      </div>

      {mine.length > 0 && (
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-3 font-semibold">Your boxes</h3>
          <ul className="space-y-2">
            {mine.map((r) => {
              const itemId = toHex(pureCircuits.itemIdOf(r.id));
              const op = holder.state?.items[itemId];
              const item = op && catalog.find((c) => c.itemType === Number(op.itemType));
              const late = r.status === REQUEST_STATUS.PENDING && now >= r.deadline;
              const position = Number(r.id - drop.openedCount) + 1;
              return (
                <li key={r.id.toString()} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-2">
                  {item ? (
                    <ItemArt dropAddress={address} itemType={item.itemType} tier={item.tier} size={44} />
                  ) : (
                    <div className="grid size-11 place-items-center rounded-lg bg-white/5">
                      <Lock className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">Box #{(r.id + 1n).toString()}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.status === REQUEST_STATUS.OPENED && (item ? `${item.name} · #${op!.serial}` : "Opened · moved to another holder")}
                      {r.status === REQUEST_STATUS.REFUNDED && "Refunded with penalty"}
                      {r.status === REQUEST_STATUS.PENDING && !late && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" /> Sealed · #{position} in queue · refundable {relativeTime(r.deadline, now)}
                        </span>
                      )}
                      {late && "The publisher missed the deadline"}
                    </p>
                  </div>
                  {late && providers && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={tx.busy}
                      onClick={() => void tx.run("Claiming refund", () => claimRefund(providers, address, r.id), () => "Refund and penalty sent to your wallet.")}
                    >
                      <Undo2 /> Refund
                    </Button>
                  )}
                  {item && (
                    <Button size="sm" variant="ghost" onClick={() => setReveal({ itemId, itemType: item.itemType, serial: op!.serial })}>
                      View
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {holder.isPublisher && holder.state?.publisher && toHex(pureCircuits.publisherKey(holder.state.publisher.secret)) === toHex(drop.publisherPk) && (
        <div className="glass rounded-2xl border border-amber-400/20 p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4 text-amber-300" /> You publish this drop
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {queue.length === 0 ? "No boxes are waiting." : `${queue.length} box${queue.length > 1 ? "es" : ""} waiting to be opened (oldest first).`}
          </p>
          {queue.length > 0 && providers && (
            <Button
              className="mt-3 w-full"
              disabled={tx.busy}
              onClick={() => void tx.run("Opening the next box", () => openNextBox(providers, address), () => "Box opened and delivered to its buyer.")}
            >
              Open next box (#{((queue[0]?.id ?? 0n) + 1n).toString()})
            </Button>
          )}
          <Link to={{ name: "studio" }} className="mt-3 block text-center text-xs text-violet-300 hover:underline">
            Manage in Studio
          </Link>
        </div>
      )}

      <Modal open={!!reveal} onClose={() => setReveal(null)} title="Your box">
        {reveal && revealed && (
          <BoxOpener
            dropAddress={address}
            item={{
              itemType: revealed.itemType,
              tier: revealed.tier,
              name: revealed.name,
              serial: reveal.serial,
              top: topLabel(revealed.tier, drop),
            }}
            onDone={() => setReveal(null)}
          />
        )}
        {reveal && (
          <div className="mt-2 flex justify-center">
            <Link to={{ name: "vault" }} className="text-sm text-violet-300 hover:underline" onClick={() => setReveal(null)}>
              Go to your vault
            </Link>
          </div>
        )}
      </Modal>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Fact({ label, value, bad, mono }: { label: string; value: string; bad?: boolean; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-medium ${bad ? "text-rose-300" : ""} ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
