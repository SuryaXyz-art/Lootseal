// SPDX-License-Identifier: Apache-2.0
// The box-opening moment: a sealed box shakes, cracks, bursts and flips to
// the item. Reduced-motion users get the result without the animation.
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { tierStyle } from "@/lib/art";
import { ItemArt, TierBadge } from "./loot";
import { ShareButtons } from "./share";
import type { ShareCard } from "@/lib/share-card";

export type OpenerPhase = "sealed" | "shaking" | "burst" | "revealed";

export function BoxOpener({
  dropAddress,
  item,
  onDone,
  share,
}: {
  dropAddress: string;
  item: { itemType: number; tier: number; name: string; serial: bigint; of?: bigint; top: string };
  onDone?: () => void;
  /** Offer to share the pull once it is revealed. */
  share?: { text: string; url: string; card?: ShareCard };
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
          <>
            <div
              className="absolute inset-0 rounded-full animate-[burst_0.6s_ease-out_forwards]"
              style={{ background: `radial-gradient(circle, ${style.color} 0%, transparent 65%)` }}
            />
            <Sparks color={style.color} />
          </>
        )}
        {phase === "revealed" && (
          <div
            className="absolute inset-[-20%] animate-[spin-slow_18s_linear_infinite] opacity-50"
            style={{
              background: `repeating-conic-gradient(from 0deg, ${style.glow} 0deg 4deg, transparent 4deg 30deg)`,
              maskImage: "radial-gradient(circle, #000 20%, transparent 70%)",
            }}
          />
        )}
        {phase === "revealed" && (
          <div className="relative animate-[card-flip_0.7s_ease-out]" style={{ filter: `drop-shadow(0 0 28px ${style.glow})` }}>
            <ItemArt dropAddress={dropAddress} itemType={item.itemType} tier={item.tier} size={240} />
          </div>
        )}
      </div>
      {phase === "revealed" ? (
        <div className="animate-[fade-up_0.5s_ease-out] space-y-2">
          <TierBadge tier={item.tier} className="text-sm">
            <Sparkles className="size-3.5" /> {style.name}
          </TierBadge>
          <h3 className="text-2xl font-bold" style={{ color: style.color, textShadow: `0 0 24px ${style.glow}` }}>
            {item.name}
          </h3>
          <p className="text-sm text-muted-foreground tabular-nums">
            #{item.serial.toString()}
            {item.of !== undefined ? ` of ${item.of.toString()}` : ""} · {item.top}
          </p>
          {share && <ShareButtons className="pt-3" text={share.text} url={share.url} card={share.card} />}
          {onDone && (
            <button className="mt-3 text-sm sec-text underline-offset-4 hover:underline" onClick={onDone}>
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

/** Twelve sparks flung out from the seal as it breaks. */
function Sparks({ color }: { color: string }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 h-1.5 w-6 rounded-full"
          style={{
            background: `linear-gradient(90deg, transparent, ${color})`,
            transformOrigin: "0 50%",
            ["--r" as string]: `${i * 30}deg`,
            animation: "spark-fly 0.7s ease-out forwards",
          }}
        />
      ))}
    </div>
  );
}

export function SealedBox({ glow, size = 168 }: { glow?: string; size?: number }) {
  const seal = glow ?? "#f6c453";
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Sealed loot box" className="overflow-visible">
      <defs>
        <linearGradient id="lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5b44b8" />
          <stop offset="100%" stopColor="#241a52" />
        </linearGradient>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#36287a" />
          <stop offset="100%" stopColor="#120d2e" />
        </linearGradient>
        <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#f6c453" />
        </linearGradient>
        <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6c453" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#f6c453" stopOpacity="0.2" />
        </linearGradient>
        <radialGradient id="seal-glow">
          <stop offset="0%" stopColor={seal} stopOpacity="0.8" />
          <stop offset="100%" stopColor={seal} stopOpacity="0" />
        </radialGradient>
        <clipPath id="box-clip">
          <rect x="12" y="34" width="96" height="70" rx="8" />
        </clipPath>
      </defs>
      <ellipse cx="60" cy="108" rx="42" ry="6" fill="#000" opacity="0.45" />
      <rect x="18" y="48" width="84" height="56" rx="8" fill="url(#body)" stroke="url(#edge)" strokeOpacity="0.7" />
      <rect x="12" y="34" width="96" height="20" rx="6" fill="url(#lid)" stroke="url(#edge)" strokeWidth="1.2" />
      <rect x="54" y="34" width="12" height="70" fill="url(#band)" />
      <path d="M22 54 h76" stroke="#fff" strokeOpacity="0.08" />
      <g clipPath="url(#box-clip)">
        <rect x="-40" y="20" width="18" height="100" fill="#fff" opacity="0.12" transform="skewX(-20)">
          <animate attributeName="x" values="-40;160;160" keyTimes="0;0.35;1" dur="4.5s" repeatCount="indefinite" />
        </rect>
      </g>
      <circle cx="60" cy="66" r="18" fill="url(#seal-glow)">
        <animate attributeName="r" values="14;20;14" dur="2.6s" repeatCount="indefinite" />
      </circle>
      <circle cx="60" cy="66" r="9.5" fill="#0b0820" stroke={seal} strokeWidth="2" />
      <path d="M56.5 66 l3.5 -4.6 l3.5 4.6 l-3.5 4.6 z" fill={seal} />
      {glow && <circle cx="60" cy="66" r="14" fill="none" stroke={glow} strokeOpacity="0.6" strokeWidth="1.5" />}
      <path d="M96 30 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 z" fill="#f6c453">
        <animate attributeName="opacity" values="0;1;0" dur="2.2s" repeatCount="indefinite" />
      </path>
      <path d="M20 44 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 z" fill="#c4b5fd">
        <animate attributeName="opacity" values="0;1;0" dur="2.9s" begin="1s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}
