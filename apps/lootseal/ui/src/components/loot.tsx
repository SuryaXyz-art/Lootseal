// SPDX-License-Identifier: Apache-2.0
// Loot visuals: item art, tier badges, odds bars and item cards.
import { useMemo, type ReactNode } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { sigilFor, tierStyle } from "@/lib/art";
import { formatPercent, tierOdds } from "../../../contract/lib.js";

export function ItemArt({
  dropAddress,
  itemType,
  tier,
  size = 120,
  className,
  hidden = false,
}: {
  dropAddress: string;
  itemType: number;
  tier: number;
  size?: number;
  className?: string;
  hidden?: boolean;
}) {
  const style = tierStyle(tier);
  const sigil = useMemo(() => sigilFor(dropAddress, itemType, tier), [dropAddress, itemType, tier]);
  const id = `g-${dropAddress.slice(0, 8)}-${itemType}-${hidden ? "h" : "v"}`;
  const color = hidden ? "#6b6f86" : style.color;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={hidden ? "Sealed item" : `${style.name} item art`}
    >
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor={hidden ? "#1b1d2b" : style.from} />
          <stop offset="100%" stopColor={hidden ? "#0a0b12" : style.to} />
        </radialGradient>
        <linearGradient id={`${id}-gem`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.9} />
          <stop offset="35%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity={0.35} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="100" height="100" rx="14" fill={`url(#${id}-bg)`} />
      {Array.from({ length: sigil.rings }, (_, i) => (
        <circle
          key={i}
          cx="50"
          cy="50"
          r={42 - i * 4}
          fill="none"
          stroke={color}
          strokeOpacity={0.12 + i * 0.05}
          strokeWidth={0.6}
          strokeDasharray={i % 2 ? "2 3" : undefined}
        />
      ))}
      <g transform={`rotate(${sigil.rotation} 50 50)`} filter={`url(#${id}-glow)`} style={{ filter: hidden ? undefined : `hue-rotate(${sigil.hueShift}deg)` }}>
        {hidden ? (
          <text x="50" y="60" textAnchor="middle" fontSize="30" fill={color} fontWeight={700} transform={`rotate(${-sigil.rotation} 50 50)`}>
            ?
          </text>
        ) : (
          <>
            <polygon points={sigil.gem.map(([x, y]) => `${x},${y}`).join(" ")} fill={`url(#${id}-gem)`} stroke={color} strokeWidth={0.8} />
            {sigil.facets.map(([x, y], i) => (
              <line key={i} x1="50" y1="50" x2={x} y2={y} stroke="#fff" strokeOpacity={0.35} strokeWidth={0.4} />
            ))}
            <circle cx="50" cy="50" r="4" fill="#fff" fillOpacity={0.85} />
          </>
        )}
      </g>
      {!hidden && sigil.runes.map((r, i) => <circle key={i} cx={r.x} cy={r.y} r={r.r} fill={color} fillOpacity={0.7} />)}
    </svg>
  );
}

export function TierBadge({ tier, className, children }: { tier: number; className?: string; children?: ReactNode }) {
  const style = tierStyle(tier);
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", className)}
      style={{ color: style.color, borderColor: `${style.color}55`, background: `${style.color}14` }}
    >
      {children ?? style.name}
    </span>
  );
}

/** Advertised odds per tier, with the "proven at launch" mark. */
export function OddsBars({
  tierTotals,
  totalSupply,
  proven,
  compact = false,
}: {
  tierTotals: bigint[];
  totalSupply: bigint;
  proven: boolean;
  compact?: boolean;
}) {
  const odds = tierOdds(tierTotals, totalSupply);
  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Advertised odds</span>
          {proven ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="size-3.5" /> Proven in zero knowledge at launch
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3.5" /> Proof pending (table not committed yet)
            </span>
          )}
        </div>
      )}
      {odds.map((p, tier) =>
        tierTotals[tier] === 0n ? null : (
          <div key={tier} className="flex items-center gap-3">
            <span className={cn("shrink-0 text-xs font-medium", compact ? "w-20" : "w-24")} style={{ color: tierStyle(tier).color }}>
              {tierStyle(tier).name}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
              <div
                className="bar-fill h-full rounded-full"
                style={{
                  width: `${Math.max(p, 1.5)}%`,
                  background: `linear-gradient(90deg, ${tierStyle(tier).color}99, ${tierStyle(tier).color})`,
                  boxShadow: `0 0 12px ${tierStyle(tier).glow}`,
                  animationDelay: `${tier * 120}ms`,
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(p)}</span>
          </div>
        ),
      )}
    </div>
  );
}

export function ItemCard({
  dropAddress,
  itemType,
  tier,
  name,
  serial,
  of,
  top,
  footer,
  className,
}: {
  dropAddress: string;
  itemType: number;
  tier: number;
  name: string;
  serial?: bigint;
  of?: bigint;
  top?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const style = tierStyle(tier);
  return (
    <div
      className={cn("glass tilt group relative flex flex-col overflow-hidden rounded-2xl p-3", className)}
      style={{ boxShadow: `0 0 0 1px ${style.color}33, 0 16px 44px -18px ${style.glow}` }}
    >
      <div className="relative overflow-hidden rounded-[14px]">
        <ItemArt
          dropAddress={dropAddress}
          itemType={itemType}
          tier={tier}
          size={220}
          className="h-auto w-full transition-transform duration-500 group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          {serial !== undefined && (
            <p className="text-xs text-muted-foreground tabular-nums">
              #{serial.toString()}
              {of !== undefined ? ` of ${of.toString()}` : ""}
            </p>
          )}
        </div>
        <TierBadge tier={tier} />
      </div>
      {top && <p className="mt-1 text-xs text-muted-foreground">{top}</p>}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}
