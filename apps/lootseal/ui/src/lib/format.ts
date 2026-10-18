// SPDX-License-Identifier: Apache-2.0
// Display formatting shared across the app.

/** 1 NIGHT = 1,000,000 STAR; on-chain amounts are in STAR. */
export const STAR_PER_NIGHT = 1_000_000n;

/** "12.5 NIGHT" from an amount in STAR. */
export function formatNight(star: bigint): string {
  const whole = star / STAR_PER_NIGHT;
  const frac = (star % STAR_PER_NIGHT).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""} NIGHT`;
}

/** Parses "12.5" (NIGHT) into STAR; throws on malformed input. */
export function parseNight(input: string): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(s)) throw new Error("Enter an amount like 10 or 2.5 (up to 6 decimals)");
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * STAR_PER_NIGHT + BigInt(frac.padEnd(6, "0") || "0");
}

export function shortHex(hex: string, head = 6, tail = 4): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** "in 3h 12m", "2d 4h ago" relative to `now` (seconds). */
export function relativeTime(targetSec: number, nowSec: number): string {
  const diff = targetSec - nowSec;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86_400);
  const h = Math.floor((abs % 86_400) / 3_600);
  const m = Math.floor((abs % 3_600) / 60);
  const s = Math.floor(abs % 60);
  const parts = d > 0 ? [`${d}d`, `${h}h`] : h > 0 ? [`${h}h`, `${m}m`] : m > 0 ? [`${m}m`, `${s}s`] : [`${s}s`];
  return diff >= 0 ? `in ${parts.join(" ")}` : `${parts.join(" ")} ago`;
}

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export function pluralize(n: number | bigint, word: string, plural = `${word}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 || n === 1n ? word : plural}`;
}
