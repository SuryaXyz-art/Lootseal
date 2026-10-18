// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { hrefFor, parseRoute } from "@/router";
import { formatNight, parseNight, relativeTime, shortHex } from "@/lib/format";
import { rng, seedOf, sigilFor, tierStyle } from "@/lib/art";
import { friendlyError } from "@/providers/tx-context";
import { catalogOf, myRequests, pendingQueue, phaseOf, topLabel, trustRecord } from "@/lib/drop-view";
import type { DropLedger } from "@/midnight/lootseal-api";
import { encodeText32 } from "../../../contract/lib.js";

const A = "ab".repeat(32);
const B = "cd".repeat(32);

describe("router", () => {
  it("parses every route and round-trips hrefs", () => {
    const routes = [
      parseRoute("#/"),
      parseRoute("#/vault"),
      parseRoute("#/bazaar"),
      parseRoute("#/studio"),
      parseRoute(`#/drop/${A}`),
      parseRoute(`#/audit/${A}`),
      parseRoute(`#/verify/${A}/${B}`),
    ];
    expect(routes.map((r) => r.name)).toEqual(["home", "vault", "bazaar", "studio", "drop", "audit", "verify"]);
    for (const r of routes) expect(parseRoute(hrefFor(r))).toEqual(r);
  });

  it("rejects malformed addresses and unknown paths", () => {
    expect(parseRoute("#/drop/xyz").name).toBe("notFound");
    expect(parseRoute(`#/verify/${A}`).name).toBe("notFound");
    expect(parseRoute("#/nope").name).toBe("notFound");
  });

  it("normalises address case", () => {
    expect(parseRoute(`#/drop/${A.toUpperCase()}`)).toEqual({ name: "drop", address: A });
  });
});

describe("format", () => {
  it("formats and parses NIGHT amounts in STAR", () => {
    expect(formatNight(5_000_000n)).toBe("5 NIGHT");
    expect(formatNight(2_500_000n)).toBe("2.5 NIGHT");
    expect(formatNight(1n)).toBe("0.000001 NIGHT");
    expect(parseNight("2.5")).toBe(2_500_000n);
    expect(parseNight("10")).toBe(10_000_000n);
    expect(() => parseNight("1.2345678")).toThrow();
    expect(() => parseNight("abc")).toThrow();
  });

  it("shows relative times both ways", () => {
    expect(relativeTime(1000 + 3 * 3600 + 120, 1000)).toBe("in 3h 2m");
    expect(relativeTime(1000, 1000 + 2 * 86400 + 4 * 3600)).toBe("2d 4h ago");
    expect(relativeTime(1030, 1000)).toBe("in 30s");
  });

  it("shortens hex", () => {
    expect(shortHex(A)).toBe("ababab…abab");
  });
});

describe("item art", () => {
  it("is deterministic per drop and item, and differs between items", () => {
    expect(sigilFor(A, 3, 1)).toEqual(sigilFor(A, 3, 1));
    expect(sigilFor(A, 3, 1)).not.toEqual(sigilFor(A, 4, 1));
    expect(sigilFor(A, 3, 1)).not.toEqual(sigilFor(B, 3, 1));
  });

  it("makes rarer tiers more ornate", () => {
    expect(sigilFor(A, 0, 0).rings).toBeGreaterThan(sigilFor(A, 0, 4).rings);
    expect(tierStyle(0).name).toBe("Legendary");
    expect(tierStyle(9).name).toBe("Common");
  });

  it("has a stable PRNG", () => {
    const a = rng(seedOf("x"));
    const b = rng(seedOf("x"));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("friendly errors", () => {
  it("unwraps contract asserts and wallet failures", () => {
    expect(friendlyError(new Error("failed assert: Sold out"))).toBe("Sold out");
    expect(friendlyError({ type: "DAppConnectorAPIError", code: "Rejected", reason: "User rejected" })).toMatch(/declined/);
    expect(friendlyError(new Error("Insufficient Funds: could not balance dust"))).toMatch(/DUST/);
  });
});

// A minimal fake of the decoded ledger: the helpers only touch these fields.
function fakeMap<K, V>(entries: [K, V][]) {
  return {
    [Symbol.iterator]: () => entries[Symbol.iterator](),
    member: (k: K) => entries.some(([x]) => x === k),
    lookup: (k: K) => entries.find(([x]) => x === k)![1],
    isEmpty: () => entries.length === 0,
    size: () => BigInt(entries.length),
  };
}

const owner = new Uint8Array(32).fill(7);
const other = new Uint8Array(32).fill(9);
const fakeDrop = (over: Partial<Record<string, unknown>> = {}): DropLedger =>
  ({
    title: encodeText32("Test"),
    catalogNames: Array.from({ length: 16 }, (_, i) => (i < 3 ? encodeText32(["A", "B", "C"][i] ?? "") : new Uint8Array(32))),
    catalogTiers: [4n, 0n, 2n, ...Array(13).fill(4n)],
    tierTotals: [10n, 0n, 20n, 0n, 70n],
    totalSupply: 100n,
    state: 2,
    saleEnd: 2000n,
    fulfillWindow: 600n,
    requestCount: 3n,
    openedCount: 1n,
    refundedCount: 0n,
    requests: fakeMap<bigint, unknown>([
      [0n, { ownerPk: owner, status: 1, requestedAt: 100n }],
      [1n, { ownerPk: other, status: 0, requestedAt: 200n }],
      [2n, { ownerPk: owner, status: 0, requestedAt: 300n }],
    ]),
    ...over,
  }) as unknown as DropLedger;

describe("drop view", () => {
  it("lists the catalog rarest first, skipping empty slots", () => {
    expect(catalogOf(fakeDrop()).map((c) => c.name)).toEqual(["B", "C", "A"]);
  });

  it("derives the sale phase", () => {
    expect(phaseOf(fakeDrop(), 1000)).toBe("live");
    expect(phaseOf(fakeDrop(), 3000)).toBe("ended");
    expect(phaseOf(fakeDrop({ requestCount: 100n }), 1000)).toBe("soldOut");
    expect(phaseOf(fakeDrop({ state: 3 }), 1000)).toBe("defaulted");
    expect(phaseOf(fakeDrop({ state: 0 }), 1000)).toBe("setup");
  });

  it("finds my requests with their refund deadlines, and the open queue", () => {
    const hex = "07".repeat(32);
    const mine = myRequests(fakeDrop(), hex);
    expect(mine.map((r) => r.id)).toEqual([2n, 0n]);
    expect(mine[0]?.deadline).toBe(900);
    expect(pendingQueue(fakeDrop()).map((q) => q.id)).toEqual([1n, 2n]);
    expect(myRequests(fakeDrop(), null)).toEqual([]);
  });

  it("labels rarity shares and the trust record", () => {
    expect(topLabel(0, fakeDrop())).toBe("Top 10%");
    expect(topLabel(2, fakeDrop())).toBe("Top 30%");
    expect(trustRecord(fakeDrop({ openedCount: 9n, refundedCount: 1n })).onTimeRate).toBeCloseTo(0.9);
    expect(trustRecord(fakeDrop({ openedCount: 0n })).onTimeRate).toBeNull();
  });
});
