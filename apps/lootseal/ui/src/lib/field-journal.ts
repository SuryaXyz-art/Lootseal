// SPDX-License-Identifier: Apache-2.0
// The field-test journal (deployments/preview-field-test.json, written by
// scripts/field-test.ts) and the live re-check of its transactions against
// the public indexer.
import journal from "../../../deployments/preview-field-test.json";

export type FieldCheck = {
  n: number;
  key: string;
  scenario: string;
  drop: string;
  actor: string;
  action: string;
  circuit?: string;
  expect: "accepted" | "rejected" | "verified";
  result: "pass" | "fail";
  detail: string;
  tx?: { hash: string; id: string; blockHeight: number; blockTimestamp: number; feesSpecks?: string };
  seconds: number;
  at: string;
};

export type FieldJournal = {
  network: string;
  registry: string;
  drops: Record<string, { title: string; story: string }>;
  startedAt: string;
  updatedAt: string;
  feePayer?: string;
  checks: FieldCheck[];
};

export const fieldJournal = journal as FieldJournal;

export type FieldSummary = {
  total: number;
  passed: number;
  transactions: number;
  refused: number;
  verified: number;
  actors: number;
  circuits: number;
  drops: number;
  firstBlock: number | null;
  lastBlock: number | null;
};

export function summarize(j: FieldJournal): FieldSummary {
  const blocks = j.checks.flatMap((c) => (c.tx ? [c.tx.blockHeight] : []));
  const people = new Set(j.checks.map((c) => c.actor).filter((a) => a !== "anyone"));
  return {
    total: j.checks.length,
    passed: j.checks.filter((c) => c.result === "pass").length,
    transactions: j.checks.filter((c) => c.tx).length,
    refused: j.checks.filter((c) => c.expect === "rejected" && c.result === "pass").length,
    verified: j.checks.filter((c) => c.expect === "verified" && c.result === "pass").length,
    actors: people.size,
    circuits: new Set(j.checks.flatMap((c) => (c.circuit && c.expect === "accepted" ? [c.circuit] : []))).size,
    drops: Object.keys(j.drops).length,
    firstBlock: blocks.length ? Math.min(...blocks) : null,
    lastBlock: blocks.length ? Math.max(...blocks) : null,
  };
}

/** Checks grouped by scenario, in journal order. */
export function byScenario(j: FieldJournal): [string, FieldCheck[]][] {
  const groups = new Map<string, FieldCheck[]>();
  for (const c of j.checks) groups.set(c.scenario, [...(groups.get(c.scenario) ?? []), c]);
  return [...groups.entries()];
}

export type ChainProof =
  | { state: "ok"; blockHeight: number; status: string; entryPoints: string[]; addresses: string[] }
  | { state: "mismatch"; reason: string }
  | { state: "error"; reason: string };

const TX_QUERY = `query ($hash: HexEncoded!) {
  transactions(offset: { hash: $hash }) {
    hash
    block { height }
    contractActions { __typename address ... on ContractCall { entryPoint } }
    ... on RegularTransaction { transactionResult { status } }
  }
}`;

/** Looks a journal transaction up on the indexer and compares it with the record. */
export async function proveOnChain(indexerUri: string, check: FieldCheck, fetchImpl: typeof fetch = fetch): Promise<ChainProof> {
  if (!check.tx) return { state: "error", reason: "no transaction" };
  try {
    const res = await fetchImpl(indexerUri, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: TX_QUERY, variables: { hash: check.tx.hash } }),
    });
    const body = (await res.json()) as {
      data?: {
        transactions: {
          block: { height: number };
          contractActions: { address: string; entryPoint?: string }[];
          transactionResult?: { status: string };
        }[];
      };
    };
    const tx = body.data?.transactions?.[0];
    if (!tx) return { state: "mismatch", reason: "not found on the indexer" };
    const entryPoints = tx.contractActions.flatMap((a) => (a.entryPoint ? [a.entryPoint] : []));
    const addresses = tx.contractActions.map((a) => a.address);
    if (tx.block.height !== check.tx.blockHeight) return { state: "mismatch", reason: `block ${tx.block.height}, journal says ${check.tx.blockHeight}` };
    if (check.circuit && check.circuit !== "deploy" && !entryPoints.includes(check.circuit)) {
      return { state: "mismatch", reason: `calls ${entryPoints.join(", ") || "nothing"}, journal says ${check.circuit}` };
    }
    return { state: "ok", blockHeight: tx.block.height, status: tx.transactionResult?.status ?? "SUCCESS", entryPoints, addresses };
  } catch (e) {
    return { state: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
