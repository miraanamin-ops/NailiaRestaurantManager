// Daily takings files (no items, one row per day): a sample in the layout of
// Square's Sales summary, Lightspeed K-Series' Monthly Turnover and Epos Now's
// Sales Report by day, plus a messy one (title rows, a "Period:" line, £ signs,
// commas in numbers, a blank line, a totals row). Each is found, read and
// imported as day totals only, never as dish sales; item files still import as
// before (tests/sales-flow.test.ts). The samples: tests/fixtures/sales/ (made by
// hand to each till's usual layout, not real exports). Claude is a stand-in: the
// tests say which columns it "picked"; tests/e2e/daily-sales.e2e.ts asks the real one.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyMapping, describeMapping, mappingWorks, parseCsv, toTable, type PosMapping } from "@/lib/sales/pos-table";
import { memoryDb } from "./support/memory-db";

const file = (name: string) => readFileSync(`tests/fixtures/sales/${name}`);
const daily = (date: string, price: string, date_order: PosMapping["date_order"], amount_basis: "net" | "gross", orders: string | null = null): PosMapping => ({
  date,
  time: null,
  item: null,
  quantity: orders,
  price,
  price_is: "line_total",
  receipt: null,
  date_order,
  amount_basis,
});

// Net sales wherever the till has a net column (Square's "Net Sales", Lightspeed's
// "Turnover excl. VAT", Epos Now's "Net Sales"); the messy file only has takings
// including VAT. Orders each day where there's a count (Lightspeed's "Receipts",
// Epos Now's "Transactions"; forecasts need them). 70 days, 1 Aug to 9 Oct 2026;
// the first day £1,550.50 with VAT, 40 orders.
const SAMPLES = [
  { name: "square-sales-summary.csv", headers: 8, mapping: daily("Date", "Net Sales", "mdy", "net"), skipped: 0, first: 1283.75, net: 1283.75, orders: null },
  { name: "lightspeed-monthly-turnover.csv", headers: 5, mapping: daily("Date", "Turnover excl. VAT", "ymd", "net", "Receipts"), skipped: 0, first: 1292.08, net: 1292.08, orders: 40 },
  { name: "epos-now-sales-report.csv", headers: 7, mapping: daily("Time Interval", "Net Sales", "dmy", "net", "Transactions"), skipped: 1, first: 1292.08, net: 1292.08, orders: 40 },
  { name: "messy-daily-takings.csv", headers: 3, mapping: daily("Date", "Takings", "dmy", "gross"), skipped: 1, first: 1550.5, net: 1292.08, orders: null },
] as const;
const TOTAL_WITH_VAT = 100290;

describe("reading each till's daily file", () => {
  for (const s of SAMPLES) {
    test(`${s.name}: the headings found, 70 days read, the totals row skipped`, () => {
      const table = toTable(parseCsv(file(s.name).toString("utf8")))!;
      expect(table.headers).toHaveLength(s.headers);
      expect(table.headers).toContain(s.mapping.price);
      expect(mappingWorks(table, s.mapping)).toBe(true);
      const { lines, skipped } = applyMapping(table, s.mapping);
      expect(lines).toHaveLength(70);
      expect(skipped).toBe(s.skipped);
      expect(lines[0]).toMatchObject({ day: "2026-08-01", item: "Daily total", amount: s.first });
      expect(lines.at(-1)?.day).toBe("2026-10-09");
      if (s.mapping.amount_basis === "gross") expect(Math.round(lines.reduce((sum, l) => sum + l.amount, 0))).toBe(TOTAL_WITH_VAT);
    });
  }

  test("the messy file: not fooled by the title or the 'Period:' line; £ and commas read", () => {
    const table = toTable(parseCsv(file("messy-daily-takings.csv").toString("utf8")))!;
    expect(table.headers).toEqual(["Date", "Day", "Takings"]);
    expect(applyMapping(table, SAMPLES[3].mapping).lines.find((l) => l.day === "2026-08-07")?.amount).toBe(1672.5);
  });

  test("how the columns are described to the owner", () => {
    expect(describeMapping(daily("Date", "Net Sales", "dmy", "net"))).toEqual([
      'Date → "Date"',
      "Time → (none)",
      "Item → (none: a daily total for each day)",
      'Takings → "Net Sales" (net sales: excluding VAT, tips and service charge)',
      "Orders → (none: forecasts need the number of orders each day)",
    ]);
    expect(describeMapping(daily("Date", "Takings", "dmy", "gross", "Transactions")).slice(-2)).toEqual(['Takings → "Takings" (including VAT)', 'Orders → "Transactions"']);
  });
});

// ---------- Importing, on the in-memory database ----------

const R = "aaaaaaaa-0000-0000-0000-0000000000d1";
let db: ReturnType<typeof memoryDb>;
const suggestMapping = vi.fn();

beforeEach(() => {
  vi.resetModules();
  suggestMapping.mockReset();
  db = memoryDb({ restaurants: [{ id: R, name: "Ember Grill", is_demo: true }], pos_imports: [], pos_layouts: [], sales_items: [], sales_hours: [], sales_days: [], audit_log: [] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/sales/ai", () => ({ suggestMapping }));
  vi.doMock("@/lib/feeds/backfill", () => ({ enqueueBackfill: async () => null }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/sales/ai", "@/lib/feeds/backfill"]) vi.doUnmock(m);
});

const upload = async (name: string) => {
  const { receivePosFile } = await import("@/lib/sales/pos-import");
  return receivePosFile({ restaurantId: R, bytes: file(name), contentType: "text/csv", fileName: name, channel: "web", sentBy: null, actor: "owner" });
};

describe("importing daily takings", () => {
  for (const s of SAMPLES) {
    test(`${s.name}: asked once, then 70 days of totals saved and no dish sales`, async () => {
      suggestMapping.mockResolvedValue({ mapping: s.mapping, posName: null, problem: null });
      const first = await upload(s.name);
      expect(first).toMatchObject({ status: "needs_mapping", message: expect.stringMatching(/Item → \(none: a daily total for each day\)[\s\S]*First day: Sat 1 Aug, £[\d,.]+[\s\S]*Reply \*YES\* to import 70 days of daily takings/) });

      const { confirmImport } = await import("@/lib/sales/pos-import");
      const done = await confirmImport(R, first.importId!, s.mapping);
      expect(done).toMatchObject({ status: "imported", message: expect.stringContaining("📊 Imported daily takings for 70 days, Sat 1 Aug to Fri 9 Oct (") });
      expect(done.message).toContain(`from "${s.mapping.price}": ${s.mapping.amount_basis === "net" ? "net sales: excluding VAT, tips and service charge" : "including VAT"}`);
      expect(db.tables.sales_days).toHaveLength(70);
      // Net sales as the till gives them (not an estimate); takings with VAT have the VAT taken off (an estimate).
      expect(db.tables.sales_days.find((d) => d.day === "2026-08-01")).toMatchObject(
        s.mapping.amount_basis === "net" ? { net_sales: s.net, gross_sales: null, net_estimated: false } : { net_sales: s.net, gross_sales: 1550.5, net_estimated: true },
      );
      // The number of orders each day, where the file has it (forecasts work from it).
      expect(db.tables.sales_days.find((d) => d.day === "2026-08-01")?.transactions).toBe(s.orders);
      expect(db.tables.sales_items).toEqual([]);
      expect(db.tables.pos_imports[0]).toMatchObject({ status: "imported", first_day: "2026-08-01", last_day: "2026-10-09", rows_imported: 70 });

      // The same layout again imports straight away, and the same days just keep their totals.
      const again = await upload(s.name);
      expect(again.status).toBe("imported");
      expect(db.tables.sales_days).toHaveLength(70);
    });
  }

  test("a file with one total for the whole period isn't daily takings", async () => {
    suggestMapping.mockResolvedValue({ mapping: null, posName: "Square", problem: "It has one total for the whole period, not one per day." });
    expect((await upload("square-sales-summary.csv")).message).toBe("I couldn't use that file: It has one total for the whole period, not one per day.");
  });
});
