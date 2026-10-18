// SPDX-License-Identifier: Apache-2.0
// Procedural item art. Every item type of every drop gets a stable sigil:
// the same (drop, type) always draws the same picture, with the tier setting
// the palette and how ornate it is. No external assets.

export interface TierStyle {
  name: string;
  /** Main colour (CSS). */
  color: string;
  /** Glow colour (CSS). */
  glow: string;
  /** Gradient stops for the card background. */
  from: string;
  to: string;
}

export const TIER_STYLES: TierStyle[] = [
  { name: "Legendary", color: "#f6c453", glow: "rgba(246,196,83,0.55)", from: "#3a2a07", to: "#120c02" },
  { name: "Epic", color: "#b18cff", glow: "rgba(177,140,255,0.5)", from: "#2a1846", to: "#0d0718" },
  { name: "Rare", color: "#5cc8ff", glow: "rgba(92,200,255,0.45)", from: "#0b2a40", to: "#040e17" },
  { name: "Uncommon", color: "#4fd69c", glow: "rgba(79,214,156,0.4)", from: "#0b3324", to: "#03110c" },
  { name: "Common", color: "#9aa7bd", glow: "rgba(154,167,189,0.3)", from: "#1d2431", to: "#0b0e14" },
];

export const tierStyle = (tier: number): TierStyle =>
  TIER_STYLES[Math.min(Math.max(Math.trunc(tier) || 0, 0), 4)] ?? (TIER_STYLES[4] as TierStyle);

/** FNV-1a over a string: a small, stable seed. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a deterministic PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Sigil {
  /** Points of the outer gem polygon (100×100 viewBox). */
  gem: [number, number][];
  /** Facet lines from the centre. */
  facets: [number, number][];
  /** Orbiting rune dots. */
  runes: { x: number; y: number; r: number }[];
  /** Rotation of the whole sigil (deg). */
  rotation: number;
  /** Number of halo rings (rarer = more). */
  rings: number;
  /** Hue shift for variety within a tier (deg). */
  hueShift: number;
}

export function sigilFor(dropAddress: string, itemType: number, tier: number): Sigil {
  const r = rng(seedOf(`${dropAddress}:${itemType}`));
  const sides = 3 + Math.floor(r() * 6); // 3..8
  const inner = 0.55 + r() * 0.25;
  const gem: [number, number][] = [];
  for (let i = 0; i < sides * 2; i++) {
    const angle = (Math.PI * i) / sides - Math.PI / 2;
    const radius = i % 2 === 0 ? 30 : 30 * inner;
    gem.push([50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)]);
  }
  const facets = gem.filter((_, i) => i % 2 === 0);
  const runeCount = 3 + Math.floor(r() * 5) + (4 - Math.min(tier, 4));
  const runes = Array.from({ length: runeCount }, (_, i) => {
    const angle = (2 * Math.PI * i) / runeCount + r() * 0.3;
    const dist = 38 + r() * 6;
    return { x: 50 + dist * Math.cos(angle), y: 50 + dist * Math.sin(angle), r: 0.8 + r() * 1.4 };
  });
  return {
    gem,
    facets,
    runes,
    rotation: Math.floor(r() * 360),
    rings: Math.max(1, 4 - Math.min(tier, 4)),
    hueShift: Math.floor(r() * 40) - 20,
  };
}
