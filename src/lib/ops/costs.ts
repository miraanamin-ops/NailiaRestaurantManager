import "server-only";
import { activeOn, valueOn } from "./history";
import { db, must } from "./db";
import type {
  FixedCostCategory,
  FixedCostRow,
  Frequency,
  IngredientPriceRow,
  InvoiceLineRow,
  InvoiceRow,
  OpsSource,
  SupplierRow,
  TargetMetric,
  TargetRow,
} from "./types";

// Suppliers, invoices, ingredient prices, fixed costs and targets
// (033_ops_costs_deals.sql). Money in whole pence.

export async function findOrAddSupplier(restaurantId: string, name: string, source: OpsSource) {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  const all = must(await db().from("suppliers").select("*").eq("restaurant_id", restaurantId), "suppliers") as SupplierRow[];
  const found = all.find((s) => s.name.trim().toLowerCase().replace(/\s+/g, " ") === key);
  if (found) return found;
  return must(await db().from("suppliers").insert({ restaurant_id: restaurantId, name: name.trim(), source }).select("*").single(), "add supplier") as SupplierRow;
}

// An invoice and its lines, as read (needs the owner's confirmation unless typed by them).
export async function saveInvoice(
  restaurantId: string,
  input: {
    supplierId: string | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    netPence?: number | null;
    vatPence?: number | null;
    grossPence?: number | null;
    photoPath?: string | null;
    mediaType?: string | null;
    read?: unknown;
    source: OpsSource;
    lines: { description: string; quantity?: number | null; unitText?: string | null; quantityStd?: number | null; lineNetPence?: number | null; vatPence?: number | null; ingredientId?: string | null; matchConfidence?: number | null }[];
  },
) {
  const invoice = must(
    await db()
      .from("invoices")
      .insert({
        restaurant_id: restaurantId,
        supplier_id: input.supplierId,
        invoice_number: input.invoiceNumber ?? null,
        invoice_date: input.invoiceDate ?? null,
        net_pence: input.netPence ?? null,
        vat_pence: input.vatPence ?? null,
        gross_pence: input.grossPence ?? null,
        photo_path: input.photoPath ?? null,
        media_type: input.mediaType ?? null,
        read: input.read ?? null,
        source: input.source,
      })
      .select("*")
      .single(),
    "save invoice",
  ) as InvoiceRow;
  const lines = input.lines.length
    ? (must(
        await db()
          .from("invoice_lines")
          .insert(
            input.lines.map((l, i) => ({
              restaurant_id: restaurantId,
              invoice_id: invoice.id,
              position: i,
              description: l.description,
              quantity: l.quantity ?? null,
              unit_text: l.unitText ?? null,
              quantity_std: l.quantityStd ?? null,
              line_net_pence: l.lineNetPence ?? null,
              vat_pence: l.vatPence ?? null,
              ingredient_id: l.ingredientId ?? null,
              match_confidence: l.matchConfidence ?? null,
            })),
          )
          .select("*"),
        "save invoice lines",
      ) as InvoiceLineRow[])
    : [];
  return { invoice, lines };
}

// The owner checked it: saved and confirmed.
export async function confirmInvoice(restaurantId: string, invoiceId: string, by: string) {
  const now = new Date().toISOString();
  must(await db().from("invoices").update({ status: "saved", confirmed_at: now, confirmed_by: by }).eq("restaurant_id", restaurantId).eq("id", invoiceId), "confirm invoice");
  must(await db().from("invoice_lines").update({ confirmed_at: now, confirmed_by: by }).eq("restaurant_id", restaurantId).eq("invoice_id", invoiceId), "confirm invoice lines");
}

// A new ingredient price from a day: pricePence for packQuantity of its unit.
export async function addIngredientPrice(
  restaurantId: string,
  input: { ingredientId: string; pricePence: number; packQuantity: number; effectiveFrom: string; supplierId?: string | null; invoiceLineId?: string | null; source: OpsSource },
) {
  if (!Number.isInteger(input.pricePence) || input.pricePence < 0) throw new Error("Price must be a whole number of pence");
  return must(
    await db()
      .from("ingredient_prices")
      .insert({
        restaurant_id: restaurantId,
        ingredient_id: input.ingredientId,
        price_pence: input.pricePence,
        pack_quantity: input.packQuantity,
        effective_from: input.effectiveFrom,
        supplier_id: input.supplierId ?? null,
        invoice_line_id: input.invoiceLineId ?? null,
        source: input.source,
      })
      .select("*")
      .single(),
    "add ingredient price",
  ) as IngredientPriceRow;
}

// Pence per unit (g, ml or each) on a day, as known at a moment.
export async function ingredientPriceOn(restaurantId: string, ingredientId: string, day: string, knownAt?: string | Date) {
  const rows = must(
    await db().from("ingredient_prices").select("*").eq("restaurant_id", restaurantId).eq("ingredient_id", ingredientId),
    "ingredient prices",
  ) as IngredientPriceRow[];
  const row = valueOn(rows, day, { knownAt });
  return row ? row.price_pence / Number(row.pack_quantity) : null;
}

export async function addFixedCost(
  restaurantId: string,
  input: { name: string; category: FixedCostCategory; amountPence: number; frequency: Frequency; effectiveFrom: string; effectiveTo?: string | null; notes?: string | null; source: OpsSource },
) {
  return must(
    await db()
      .from("fixed_costs")
      .insert({
        restaurant_id: restaurantId,
        name: input.name,
        category: input.category,
        amount_pence: input.amountPence,
        frequency: input.frequency,
        effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo ?? null,
        notes: input.notes ?? null,
        source: input.source,
      })
      .select("*")
      .single(),
    "add fixed cost",
  ) as FixedCostRow;
}

// Ends a fixed cost from a day (the row isn't deleted).
export async function endFixedCost(restaurantId: string, fixedCostId: string, fromDay: string) {
  must(await db().from("fixed_costs").update({ effective_to: fromDay }).eq("restaurant_id", restaurantId).eq("id", fixedCostId), "end fixed cost");
}

export async function fixedCostsOn(restaurantId: string, day: string) {
  return activeOn(must(await db().from("fixed_costs").select("*").eq("restaurant_id", restaurantId), "fixed costs") as FixedCostRow[], day);
}

// What a fixed cost comes to for one week, in pence (monthly x 12 / 52 etc.).
export function weeklyPence(c: { amount_pence: number; frequency: Frequency }) {
  const perYear = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1, one_off: 0 }[c.frequency];
  return Math.round((c.amount_pence * perYear) / 52);
}

export async function setTarget(restaurantId: string, metric: TargetMetric, value: number, effectiveFrom: string, source: OpsSource) {
  return must(
    await db().from("targets").insert({ restaurant_id: restaurantId, metric, value, effective_from: effectiveFrom, source }).select("*").single(),
    "set target",
  ) as TargetRow;
}

export async function targetOn(restaurantId: string, metric: TargetMetric, day: string, knownAt?: string | Date) {
  const rows = must(await db().from("targets").select("*").eq("restaurant_id", restaurantId).eq("metric", metric), "targets") as TargetRow[];
  const row = valueOn(rows, day, { knownAt });
  return row ? Number(row.value) : null;
}
