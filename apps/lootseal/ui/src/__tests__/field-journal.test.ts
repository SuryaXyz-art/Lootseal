// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { byScenario, pool, proveOnChain, summarize, type FieldCheck, type FieldJournal } from "@/lib/field-journal";

const tx = (blockHeight: number) => ({ hash: "ab".repeat(32), id: "1", blockHeight, blockTimestamp: 0 });
const check = (over: Partial<FieldCheck>): FieldCheck => ({
  n: 1, key: "k", scenario: "A", drop: "d", actor: "aria", action: "Buy", circuit: "requestBox",
  expect: "accepted", result: "pass", detail: "", seconds: 1, at: "", ...over,
});
const journal = (checks: FieldCheck[]): FieldJournal => ({
  network: "preview", registry: "r", drops: { d: { title: "T", story: "S" } }, startedAt: "", updatedAt: "", checks,
});

describe("field journal", () => {
  it("summarizes transactions, refusals and actors", () => {
    const s = summarize(
      journal([
        check({ key: "a", tx: tx(10) }),
        check({ key: "b", actor: "kenji", circuit: "openBox", tx: tx(12) }),
        check({ key: "c", actor: "anyone", expect: "verified", circuit: undefined }),
        check({ key: "d", actor: "mallory", expect: "rejected", circuit: "openBox" }),
        check({ key: "e", expect: "rejected", result: "fail" }),
      ]),
    );
    expect(s).toMatchObject({ total: 5, passed: 4, transactions: 2, refused: 1, verified: 1, actors: 3, circuits: 2, drops: 1, firstBlock: 10, lastBlock: 12 });
  });

  it("groups checks by scenario in order", () => {
    const g = byScenario(journal([check({ key: "1", scenario: "B" }), check({ key: "2", scenario: "A" }), check({ key: "3", scenario: "B" })]));
    expect(g.map(([s, cs]) => [s, cs.length])).toEqual([["B", 2], ["A", 1]]);
  });

  it("confirms a transaction only when the indexer agrees with the journal", async () => {
    const indexer = (height: number, entryPoint: string) =>
      (async () => ({
        json: async () => ({
          data: { transactions: [{ block: { height }, contractActions: [{ address: "d", entryPoint }], transactionResult: { status: "SUCCESS" } }] },
        }),
      })) as unknown as typeof fetch;
    const c = check({ tx: tx(42) });
    expect(await proveOnChain("u", c, indexer(42, "requestBox"))).toMatchObject({ state: "ok", blockHeight: 42 });
    expect(await proveOnChain("u", c, indexer(43, "requestBox"))).toMatchObject({ state: "mismatch" });
    expect(await proveOnChain("u", c, indexer(42, "openBox"))).toMatchObject({ state: "mismatch" });
    const empty = (async () => ({ json: async () => ({ data: { transactions: [] } }) })) as unknown as typeof fetch;
    expect(await proveOnChain("u", c, empty)).toMatchObject({ state: "mismatch", reason: "not found on the indexer" });
  });

  it("runs a bounded pool", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      inFlight--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
