// Each till's own API answer turned into TillOrders. Pure, unit-tested
// (tests/tills.test.ts) with answers shaped like each provider's documentation.
import { londonTime } from "@/lib/clock";
import type { TillLine, TillOrder } from "./types";

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
// Also reads "+0000" offsets (Toast), which not every JavaScript engine parses.
const date = (v: unknown) => {
  const d = typeof v === "string" && v ? new Date(v.trim().replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

// A time with no zone ("2026-11-05T12:30:00", as Epos Now sends it) is UK time.
export function ukLocalTime(v: unknown): Date | null {
  const s = text(v);
  if (!s) return null;
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) return date(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return londonTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

// ---------- Square (Orders API: POST /v2/orders/search) ----------
// Money is in pence. total_money is the line after discounts, including VAT.
type SquareMoney = { amount?: number | null } | null | undefined;
export type SquareOrder = {
  id?: string;
  state?: string;
  closed_at?: string | null;
  line_items?: { name?: string; variation_name?: string; quantity?: string; total_money?: SquareMoney }[];
};

export function mapSquareOrders(orders: SquareOrder[]): TillOrder[] {
  const out: TillOrder[] = [];
  for (const o of orders) {
    const closedAt = date(o.closed_at);
    if (!o.id || o.state !== "COMPLETED" || !closedAt) continue;
    const lines: TillLine[] = (o.line_items ?? []).map((li) => {
      const variation = text(li.variation_name);
      const base = text(li.name) || variation || "Custom amount";
      const item = variation && text(li.name) && !/^regular$/i.test(variation) ? `${base} (${variation})` : base;
      return { item, quantity: num(li.quantity) || 1, amount: round2(num(li.total_money?.amount) / 100) };
    });
    out.push({ id: o.id, closedAt, lines, covers: null });
  }
  return out;
}

// ---------- Epos Now (API v4: GET /api/v4/Transaction/GetByDate) ----------
// Product names come from GET /api/v4/Product (passed in as a map).
// UnitPrice includes VAT; DiscountAmount is off the whole line.
export type EposNowTransaction = {
  Id?: number;
  DateTime?: string;
  StatusId?: number | null;
  TransactionItems?: { ProductId?: number | null; UnitPrice?: number | null; Quantity?: number | null; DiscountAmount?: number | null }[];
};

export const EPOSNOW_COMPLETED = 1;

export function mapEposNowTransactions(rows: EposNowTransaction[], productNames: Map<number, string>): TillOrder[] {
  const out: TillOrder[] = [];
  for (const t of rows) {
    const closedAt = ukLocalTime(t.DateTime);
    if (t.Id == null || !closedAt) continue;
    if (t.StatusId != null && t.StatusId !== EPOSNOW_COMPLETED) continue;
    const lines: TillLine[] = (t.TransactionItems ?? []).map((li) => {
      const qty = num(li.Quantity) || 1;
      return {
        item: (li.ProductId != null && productNames.get(li.ProductId)) || "Other item",
        quantity: qty,
        amount: round2(num(li.UnitPrice) * qty - num(li.DiscountAmount)),
      };
    });
    out.push({ id: String(t.Id), closedAt, lines, covers: null });
  }
  return out;
}

// ---------- Lightspeed K-Series (Financial API v2: GET /f/v2/business-location/{id}/sales) ----------
// Amounts are strings. totalNetAmountWithTax is the line including VAT (UK
// businesses are tax-inclusive). Refunds come as their own REFUND sales.
export type LightspeedSale = {
  receiptId?: string;
  accountFiscId?: string;
  timeClosed?: string;
  cancelled?: boolean;
  type?: string;
  nbCovers?: number | null;
  salesLines?: { id?: string; name?: string; nameOverride?: string; quantity?: string; totalNetAmountWithTax?: string; parentLineId?: string | null }[];
};

const LIGHTSPEED_COUNTED = new Set(["SALE", "REFUND"]);

export function mapLightspeedSales(sales: LightspeedSale[]): TillOrder[] {
  const out: TillOrder[] = [];
  for (const s of sales) {
    const closedAt = date(s.timeClosed);
    const id = text(s.accountFiscId) || text(s.receiptId);
    if (!id || !closedAt || s.cancelled || !LIGHTSPEED_COUNTED.has(s.type ?? "SALE")) continue;
    const lines: TillLine[] = [];
    for (const l of s.salesLines ?? []) {
      const amount = round2(num(l.totalNetAmountWithTax));
      // An add-on line (parentLineId) that cost nothing isn't a sale of its own.
      if (l.parentLineId && amount === 0) continue;
      lines.push({ item: text(l.nameOverride) || text(l.name) || "Other item", quantity: num(l.quantity) || 1, amount });
    }
    out.push({ id: `${id}${s.type === "REFUND" ? ":refund" : ""}`, closedAt, lines, covers: s.type === "REFUND" ? null : num(s.nbCovers) || null });
  }
  return out;
}

// ---------- Toast (Orders API: GET /orders/v2/ordersBulk) ----------
// price is the selection after discounts, including its modifiers. Whether it
// already includes VAT depends on taxInclusion (UK menus usually do).
export type ToastOrder = {
  guid?: string;
  closedDate?: string | null;
  voided?: boolean;
  deleted?: boolean;
  numberOfGuests?: number | null;
  checks?: {
    voided?: boolean;
    deleted?: boolean;
    selections?: { displayName?: string; quantity?: number; price?: number | null; tax?: number | null; voided?: boolean; taxInclusion?: string | null }[];
  }[];
};

export function mapToastOrders(orders: ToastOrder[]): TillOrder[] {
  const out: TillOrder[] = [];
  for (const o of orders) {
    const closedAt = date(o.closedDate);
    if (!o.guid || !closedAt || o.voided || o.deleted) continue;
    const lines: TillLine[] = [];
    for (const c of o.checks ?? []) {
      if (c.voided || c.deleted) continue;
      for (const s of c.selections ?? []) {
        if (s.voided) continue;
        const included = s.taxInclusion === "INCLUDED";
        lines.push({ item: text(s.displayName) || "Other item", quantity: num(s.quantity) || 1, amount: round2(num(s.price) + (included ? 0 : num(s.tax))) });
      }
    }
    out.push({ id: o.guid, closedAt, lines, covers: num(o.numberOfGuests) || null });
  }
  return out;
}
