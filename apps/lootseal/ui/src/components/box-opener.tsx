// SPDX-License-Identifier: Apache-2.0
// The box-opening moment: a sealed box shakes, cracks, bursts and flips to
// the item. Reduced-motion users get the result without the animation.
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { tierStyle } from "@/lib/art";
import { ItemArt, TierBadge } from "./loot";

export type OpenerPhase = "sealed" | "shaking" | "burst" | "revealed";

export function BoxOpener({
  dropAddress,
  item,
  onDone,
}: {
  dropAddress: string;
  item: { itemType: number; tier: number; name: string; serial: bigint; of?: bigint; top: string };
  onDone?: () => void;
}) {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [phase, setPhase] = useState<OpenerPhase>(reduced ? "revealed" : "shaking");
  const style = tierStyle(item.tier);

  useEffect(() => {
    if (reduced) return;
    const t1 = window.setTimeout(() => setPhase("burst"), 1400);
    const t2 = window.setTimeout(() => setPhase("revealed"), 1900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [reduced]);

  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <div className="relative grid size-64 place-items-center">
        {phase !== "revealed" && (
          <div className={phase === "shaking" ? "animate-[box-shake_0.45s_ease-in-out_infinite]" : "animate-[box-pop_0.5s_ease-out_forwards]"}>
            <SealedBox glow={phase === "burst" ? style.color : undefined} />
          </div>
        )}
        {phase === "burst" && (
          <div
            className="absolute inset-0 rounded-full animate-[burst_0.6s_ease-out_forwards]"
            style={{ background: `radial-gradient(circle, ${style.color} 0%, transparent 65%)` }}
          />
        )}
        {phase === "revealed" && (
          <div className="animate-[card-flip_0.7s_ease-out]" style={{ filter: `drop-shadow(0 0 28px ${style.glow})` }}>
            <ItemArt dropAddress={dropAddress} itemType={item.itemType} tier={item.tier} size={240} />
          </div>
        )}
      </div>
      {phase === "revealed" ? (
        <div className="animate-[fade-up_0.5s_ease-out] space-y-2">
          <TierBadge tier={item.tier} className="text-sm">
            <Sparkles className="size-3.5" /> {style.name}
          </TierBadge>
          <h3 className="text-2xl font-bold">{item.name}</h3>
          <p className="text-sm text-muted-foreground tabular-nums">
            #{item.serial.toString()}
            {item.of !== undefined ? ` of ${item.of.toString()}` : ""} · {item.top}
          </p>
          {onDone && (
            <button className="mt-3 text-sm text-violet-300 underline-offset-4 hover:underline" onClick={onDone}>
              Close
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Breaking the seal…</p>
      )}
    </div>
  );
}

export function SealedBox({ glow, size = 168 }: { glow?: string; size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Sealed loot box">
      <defs>
        <linearGradient id="lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4c3a8f" />
          <stop offset="100%" stopColor="#221a46" />
        </linearGradient>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f2563" />
          <stop offset="100%" stopColor="#120d2a" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="108" rx="40" ry="6" fill="#000" opacity="0.4" />
      <rect x="18" y="48" width="84" height="56" rx="8" fill="url(#body)" stroke="#8b7cf6" strokeOpacity="0.5" />
      <rect x="12" y="34" width="96" height="20" rx="6" fill="url(#lid)" stroke="#a78bfa" strokeOpacity="0.7" />
      <rect x="54" y="34" width="12" height="70" fill="#a78bfa" opacity="0.35" />
      <circle cx="60" cy="66" r="9" fill="#0b0820" stroke={glow ?? "#c4b5fd"} strokeWidth="2" />
      <path d="M57 66 l3 -4 l3 4 l-3 4 z" fill={glow ?? "#c4b5fd"} />
      {glow && <circle cx="60" cy="66" r="14" fill="none" stroke={glow} strokeOpacity="0.6" strokeWidth="1.5" />}
    </svg>
  );
}
