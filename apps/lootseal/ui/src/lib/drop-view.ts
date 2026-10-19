// SPDX-License-Identifier: Apache-2.0
// Pure helpers that turn a drop's public ledger into what the UI shows.
import type { DropLedger } from "@/midnight/lootseal-api";
import { decodeText32, formatPercent, isEmpty32, topShare } from "../../../contract/lib.js";
import { toHex } from "../../../contract/witnesses.js";

export const DROP_STATE = { SETUP: 0, TABLE_COMMITTED: 1, LIVE: 2, DEFAULTED: 3, REVEALED: 4 } as const;
export const REQUEST_STATUS = { PENDING: 0, OPENED: 1, REFUNDED: 2 } as const;
export const LISTING_STATUS = { OPEN: 0, PENDING: 1, SOLD: 2, CANCELLED: 3 } as const;

export interface CatalogItem {
  itemType: number;
  name: string;
  tier: number;
}

export function catalogOf(d: DropLedger): CatalogItem[] {
  return d.catalogNames
    .map((n, i) => ({ itemType: i, name: decodeText32(n), tier: Number(d.catalogTiers[i]), empty: isEmpty32(n) }))
    .filter((c) => !c.empty)
    .map(({ itemType, name, tier }) => ({ itemType, name, tier }))
    .sort((a, b) => a.tier - b.tier || a.itemType - b.itemType);
}

export type Phase = "setup" | "live" | "soldOut" | "ended" | "defaulted" | "revealed";

export function phaseOf(d: DropLedger, now: number): Phase {
  switch (d.state) {
    case DROP_STATE.SETUP:
    case DROP_STATE.TABLE_COMMITTED:
      return "setup";
    case DROP_STATE.DEFAULTED:
      return "defaulted";
    case DROP_STATE.REVEALED:
      return "revealed";
    default:
      if (d.requestCount >= d.totalSupply) return "soldOut";
      if (now >= Number(d.saleEnd)) return "ended";
      return "live";
  }
}

export const PHASE_LABEL: Record<Phase, string> = {
  setup: "Launching",
  live: "Live",
  soldOut: "Sold out",
  ended: "Sale ended",
  defaulted: "Defaulted",
  revealed: "Revealed",
};

/** The odds proof ran once the table was committed. */
export const oddsProven = (d: DropLedger): boolean => d.state !== DROP_STATE.SETUP;

export interface MyRequest {
  id: bigint;
  status: number;
  requestedAt: number;
  deadline: number;
}

export function myRequests(d: DropLedger, ownerKeyHex: string | null): MyRequest[] {
  if (!ownerKeyHex) return [];
  const out: MyRequest[] = [];
  for (const [id, r] of d.requests) {
    if (toHex(r.ownerPk) !== ownerKeyHex) continue;
    out.push({
      id,
      status: Number(r.status),
      requestedAt: Number(r.requestedAt),
      deadline: Number(r.requestedAt + d.fulfillWindow),
    });
  }
  return out.sort((a, b) => Number(b.id - a.id));
}

/** Requests waiting to be opened, oldest first. */
export function pendingQueue(d: DropLedger): { id: bigint; requestedAt: number }[] {
  const out: { id: bigint; requestedAt: number }[] = [];
  for (let id = d.openedCount; id < d.requestCount; id++) {
    const r = d.requests.lookup(id);
    if (Number(r.status) === REQUEST_STATUS.PENDING) out.push({ id, requestedAt: Number(r.requestedAt) });
  }
  return out;
}

export const topLabel = (tier: number, d: DropLedger): string => {
  const share = topShare(tier, d.tierTotals, d.totalSupply);
  // The lowest tier covers every box, where "Top 100%" reads oddly.
  return share >= 99.95 ? "Base tier" : `Top ${formatPercent(share)}`;
};

export interface TrustRecord {
  opened: number;
  refunded: number;
  /** Boxes opened as a share of boxes that were due (opened + refunded). */
  onTimeRate: number | null;
}

export function trustRecord(d: DropLedger): TrustRecord {
  const opened = Number(d.openedCount);
  const refunded = Number(d.refundedCount);
  const due = opened + refunded;
  return { opened, refunded, onTimeRate: due === 0 ? null : opened / due };
}

export interface ListingView {
  dropAddress: string;
  itemId: string;
  price: bigint;
  maxTier: number;
  status: number;
  stale: boolean;
  deadline: number;
  buyerOwnerPk: string;
}

export function listingsOf(dropAddress: string, d: DropLedger): ListingView[] {
  const out: ListingView[] = [];
  for (const [itemId, l] of d.listings) {
    const delivery = d.deliveries.member(itemId) ? d.deliveries.lookup(itemId) : null;
    out.push({
      dropAddress,
      itemId: toHex(itemId),
      price: l.price,
      maxTier: Number(l.maxTier),
      status: Number(l.status),
      stale: !delivery || delivery.version !== l.version,
      deadline: Number(l.deadline),
      buyerOwnerPk: toHex(l.buyerOwnerPk),
    });
  }
  return out;
}

export interface BadgeView {
  itemId: string;
  maxTier: number;
  context: string;
  version: bigint;
  current: boolean;
}

export function badgeOf(d: DropLedger, badgeIdHex: string): BadgeView | null {
  for (const [id, b] of d.badges) {
    if (toHex(id) !== badgeIdHex) continue;
    const delivery = d.deliveries.member(b.itemId) ? d.deliveries.lookup(b.itemId) : null;
    return {
      itemId: toHex(b.itemId),
      maxTier: Number(b.maxTier),
      context: decodeText32(b.context),
      version: b.version,
      current: !!delivery && delivery.version === b.version,
    };
  }
  return null;
}

/** Badges of one item (any version). */
export function badgesForItem(d: DropLedger, itemIdHex: string): { badgeId: string; maxTier: number; context: string; current: boolean }[] {
  const out: { badgeId: string; maxTier: number; context: string; current: boolean }[] = [];
  const delivery = (() => {
    for (const [id, del] of d.deliveries) if (toHex(id) === itemIdHex) return del;
    return null;
  })();
  for (const [id, b] of d.badges) {
    if (toHex(b.itemId) !== itemIdHex) continue;
    out.push({ badgeId: toHex(id), maxTier: Number(b.maxTier), context: decodeText32(b.context), current: !!delivery && delivery.version === b.version });
  }
  return out;
}
