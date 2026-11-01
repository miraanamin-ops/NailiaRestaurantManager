// The Pilot Zero test files (pilot-zero/, made by pilot-zero/make-files.mjs) go
// through the real importers: the sales importer (receivePosFile, then
// confirmImport with the columns Claude would pick; tests/e2e/daily-sales.e2e.ts
// asks the real Claude), Dina's sales coverage, her team checks and the staff
// message parser. If a file is rejected, the file is fixed, not the importer.
import { readFileSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { availabilityOf, salesCoverage, teamCard, teamProblems, type StaffInputRow } from "@/lib/onboarding/dina/ops-content";
import { MAX_FILE_BYTES } from "@/lib/sales/pos-file";
import { parseCsv, toTable, type PosMapping } from "@/lib/sales/pos-table";
import { parseStaffCommand } from "@/lib/rota/staff-input";
import { memoryDb } from "./support/memory-db";

const path = (name: string) => `pilot-zero/${name}`;
const file = (name: string) => readFileSync(path(name));
const SUMMARY = "square-sales-summary-12-months.csv";
const TRANSACTIONS = "square-transactions-6-weeks.csv";

// The columns, as for the Square samples in tests/daily-sales.test.ts.
const daily = (date_order: PosMapping["date_order"], receipt: string | null = null): PosMapping => ({
  date: "Date",
  time: null,
  item: null,
  quantity: null,
  price: "Net Sales",
  price_is: "line_total",
  receipt,
  date_order,
  amount_basis: "net",
});

const R = "aaaaaaaa-0000-0000-0000-0000000000f1";
let db: ReturnType<typeof memoryDb>;
const suggestMapping = vi.fn();

beforeEach(() => {
  vi.resetModules();
  suggestMapping.mockReset();
  db = memoryDb({ restaurants: [{ id: R, name: "Pilot Zero Food Hall", is_demo: false }], pos_imports: [], pos_layouts: [], sales_items: [], sales_hours: [], sales_days: [], audit_log: [] });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/sales/ai", () => ({ suggestMapping }));
  vi.doMock("@/lib/feeds/backfill", () => ({ enqueueBackfill: async () => null }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/sales/ai", "@/lib/feeds/backfill"]) vi.doUnmock(m);
});

async function importFile(name: string, mapping: PosMapping) {
  suggestMapping.mockResolvedValue({ mapping, posName: "Square", problem: null });
  const { receivePosFile, confirmImport } = await import("@/lib/sales/pos-import");
  const first = await receivePosFile({ restaurantId: R, bytes: file(name), contentType: "text/csv", fileName: name, channel: "web", sentBy: null, actor: "owner" });
  expect(first.status).toBe("needs_mapping");
  return confirmImport(R, first.importId!, mapping);
}

const net = (day: string) => Number(db.tables.sales_days.find((d) => d.day === day)?.net_sales ?? NaN);
const avg = (days: string[]) => days.reduce((s, d) => s + net(d), 0) / days.length;
const datesBetween = (from: string, to: string, weekdays: number[]) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) {
    const wd = ((new Date(t).getUTCDay() + 6) % 7) + 1;
    if (weekdays.includes(wd)) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};

describe("the 12-month Square Sales summary", () => {
  test("imports as a year of daily takings, Nov 2025 to Oct 2026, with the closed days missing", async () => {
    const done = await importFile(SUMMARY, daily("mdy"));
    expect(done).toMatchObject({ status: "imported", message: expect.stringContaining("Imported daily takings for 361 days") });
    expect(db.tables.sales_days).toHaveLength(361);
    const days = db.tables.sales_days.map((d) => String(d.day)).sort();
    expect([days[0], days.at(-1)]).toEqual(["2025-11-01", "2026-10-31"]);
    for (const closed of ["2025-12-25", "2026-07-13", "2026-07-14", "2026-07-15"]) expect(days).not.toContain(closed);
    expect(db.tables.sales_days.every((d) => d.net_estimated === false && d.source === "pos")).toBe(true);
    expect(salesCoverage(days[0], days.at(-1)!)).toMatchObject({ enough: true, text: "12 months of sales, Nov 2025 to Oct 2026" });
  });

  test("has the patterns in it: the week, Ramadan, the Eids, school holidays and the big event", async () => {
    await importFile(SUMMARY, daily("mdy"));
    const fridays = datesBetween("2026-01-05", "2026-02-13", [5]);
    const mondays = datesBetween("2026-01-05", "2026-02-13", [1]);
    expect(avg(fridays)).toBeGreaterThan(avg(mondays) * 1.8); // Friday prayers and the weekend
    // Ramadan (18 Feb to 19 Mar 2026) busier than the weeks before; the last ten nights busier still.
    const before = datesBetween("2026-01-19", "2026-02-13", [1, 2, 3, 4]);
    expect(avg(datesBetween("2026-02-23", "2026-03-05", [1, 2, 3, 4]))).toBeGreaterThan(avg(before) * 1.05);
    expect(avg(datesBetween("2026-03-10", "2026-03-19", [1, 2, 3, 4]))).toBeGreaterThan(avg(datesBetween("2026-02-23", "2026-03-05", [1, 2, 3, 4])));
    // Eid al-Fitr (Fri 20 Mar) and Eid al-Adha (Wed 27 May): about double a usual day.
    expect(net("2026-03-20")).toBeGreaterThan(avg(datesBetween("2026-04-17", "2026-05-15", [5])) * 1.8);
    expect(net("2026-05-27")).toBeGreaterThan(avg(datesBetween("2026-04-13", "2026-05-15", [3])) * 1.7);
    // The big event (Sat 13 Jun) and the summer holiday weekdays.
    expect(net("2026-06-13")).toBeGreaterThan(avg(datesBetween("2026-05-30", "2026-06-27", [6]).filter((d) => d !== "2026-06-13")) * 1.6);
    expect(avg(datesBetween("2026-07-27", "2026-08-21", [1, 2, 3, 4]))).toBeGreaterThan(avg(datesBetween("2026-06-15", "2026-07-10", [1, 2, 3, 4])) * 1.1);
  });
});

describe("the 6-week Square Transactions file", () => {
  test("small enough to send on WhatsApp, and imports 42 days with each day's number of orders", async () => {
    expect(statSync(path(TRANSACTIONS)).size).toBeLessThan(MAX_FILE_BYTES);
    const table = toTable(parseCsv(file(TRANSACTIONS).toString("utf8")))!;
    expect(table.headers).toHaveLength(31);
    const done = await importFile(TRANSACTIONS, daily("dmy", "Transaction ID"));
    expect(done).toMatchObject({ status: "imported", message: expect.stringContaining("Imported daily takings for 42 days") });
    expect(db.tables.sales_days).toHaveLength(42);
    expect(db.tables.sales_days.every((d) => Number(d.transactions) > 40)).toBe(true);
    expect(db.tables.sales_items).toEqual([]); // daily totals, never dish sales
  });

  test("matches the Sales summary for the same days (refunds included), so importing both agrees", async () => {
    await importFile(SUMMARY, daily("mdy"));
    const fromSummary = new Map(db.tables.sales_days.map((d) => [String(d.day), Number(d.net_sales)]));
    db.tables.sales_days.length = 0;
    await importFile(TRANSACTIONS, daily("dmy", "Transaction ID"));
    for (const d of db.tables.sales_days) expect(Number(d.net_sales)).toBeCloseTo(fromSummary.get(String(d.day))!, 1);
    // A refund day: takings lowered, and the refund isn't an order.
    const refundDay = db.tables.sales_days.find((d) => d.day === "2026-10-10")!;
    expect(Number(refundDay.net_sales)).toBeCloseTo(fromSummary.get("2026-10-10")!, 1);
  });
});

// ---------- The team ----------

const STAFF_ROWS = () => {
  const table = toTable(parseCsv(file("staff-sheet.csv").toString("utf8")))!;
  return table.rows.map((r) => Object.fromEntries(table.headers.map((h, i) => [h, String(r[i] ?? "")])));
};

describe("the staff sheet", () => {
  test("10 people, everyone at £12.71 an hour or more, with mixed availability", () => {
    const rows = STAFF_ROWS();
    expect(rows).toHaveLength(10);
    for (const r of rows) expect(Number(r["Hourly rate"].replace("£", ""))).toBeGreaterThanOrEqual(12.71);
    expect(new Set(rows.map((r) => r["Days available"])).size).toBeGreaterThanOrEqual(6);
    expect(new Set(rows.map((r) => r.Role))).toEqual(new Set(["Manager", "Kitchen", "Front of house", "Delivery"]));
  });

  // What Dina's save_team gets from the sheet: every column as written.
  const sheetTeam = () => {
    const roleOf = (r: string) => ({ Manager: "manager", Kitchen: "kitchen", "Front of house": "front", Delivery: "delivery" })[r] as StaffInputRow["role"];
    const staff: StaffInputRow[] = STAFF_ROWS().map((r) => ({
      name: r.Name,
      role: roleOf(r.Role),
      hourly_rate: Number(r["Hourly rate"].replace("£", "")),
      contracted_hours: Number(r["Contracted hours"]),
      days: r["Days available"],
      times: r["Times available"],
      max_hours: Number(r["Max hours a week"]),
    }));
    const rules = [
      { role: "manager" as const, min_on_shift: 1 },
      { role: "kitchen" as const, min_on_shift: 2 },
      { role: "front" as const, min_on_shift: 2 },
    ];
    return { staff, manager: "Yusuf Rahman", cover_rules: rules, labour_target_pct: 28 };
  };

  test("the sheet as written passes Dina's team checks (availability included), with the staffing rules", () => {
    expect(teamProblems(sheetTeam())).toEqual([]);
  });

  test("the team card shows everyone's availability for the owner to check", () => {
    const card = teamCard(sheetTeam());
    expect(card.fields).toHaveLength(13); // 10 people, the manager, cover, the target
    expect(card.fields.find((f) => f.label === "Aisha Patel")?.value).toBe("Front of house · £12.71 an hour · 20h contracted · Fri to Sun · 17:00 to 23:00 · max 20h a week");
    expect(card.fields.find((f) => f.label === "Farah Begum")?.value).toBe("Kitchen · £12.71 an hour · 16h contracted · Sat, Sun · max 20h a week"); // "Any time": no limit
    expect(card.fields.find((f) => f.label === "On every shift")?.value).toBe("at least 1 manager, at least 2 kitchen, at least 2 front of house");
  });

  test("the sheet and the WhatsApp lines give each person the same availability (the lines stay a fallback)", () => {
    const lines = readFileSync(path("staff-availability-messages.txt"), "utf8").trim().split("\n").map((l) => parseStaffCommand(l) as { input: { name: string; days: number[] | null; starts: string | null; ends: string | null; maxHours: number | null } });
    for (const s of sheetTeam().staff) {
      const fromLine = lines.find((l) => l.input.name === s.name)!.input;
      const a = availabilityOf(s);
      expect([a.days ?? [1, 2, 3, 4, 5, 6, 7], a.starts, a.ends, a.maxHours]).toEqual([fromLine.days ?? [1, 2, 3, 4, 5, 6, 7], fromLine.starts, fromLine.ends, fromLine.maxHours]);
    }
  });

  test("every availability line is read in full by the staff parser (days, times, pay, max hours)", () => {
    const lines = readFileSync(path("staff-availability-messages.txt"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(10);
    const parsed = lines.map((l) => parseStaffCommand(l));
    for (const p of parsed) expect(p?.name).toBe("add_rota_staff");
    const by = Object.fromEntries(parsed.map((p) => [(p as { input: { name: string } }).input.name, (p as { input: Record<string, unknown> }).input]));
    expect(by["Yusuf Rahman"]).toMatchObject({ roles: ["manager"], ratePence: 1550, days: [1, 2, 3, 4, 5], starts: null, maxHours: 45 });
    expect(by["Sana Akhtar"]).toMatchObject({ days: [4, 5, 6, 7], starts: "12:00", ends: "23:00", maxHours: 36 });
    expect(by["Imran Qureshi"]).toMatchObject({ roles: ["kitchen"], days: [3, 4, 5, 6, 7], starts: "17:00", ends: "23:59" });
    expect(by["Tomasz Nowak"]).toMatchObject({ days: [1, 2, 3, 4], starts: "12:00", ends: "18:00", maxHours: 25 });
    expect(by["Aisha Patel"]).toMatchObject({ roles: ["front"], ratePence: 1271, days: [5, 6, 7], starts: "17:00", ends: "23:00", maxHours: 20 });
    expect(by["Daniel Mensah"]).toMatchObject({ days: [1, 2, 3, 4, 5, 6, 7], starts: "11:00", ends: "17:00" });
    expect(by["Hamza Siddiqui"]).toMatchObject({ roles: ["delivery"], ratePence: 1275, days: [4, 5, 6, 7] });
    expect(Object.values(by).every((s) => Number(s.ratePence) >= 1271)).toBe(true);
  });
});

// ---------- Removing the made-up sales (lib/pilot-zero-sales.ts) ----------

describe("removing imported sales from the Pilot Zero restaurant", () => {
  const mark = (on: boolean) => Object.assign(db.tables.restaurants[0], { pilot_zero: on });
  const remove = async (target: { importId: string } | { from: string; to: string }, confirm = "pilot zero food hall") => {
    const { removeImportedSales } = await import("@/lib/pilot-zero-sales");
    return removeImportedSales({ restaurantId: R, target, confirm, builderEmail: "me@b.dev" });
  };

  test("by upload: that upload's days go, its file is deleted, till reports stay; then a date range wipes the rest", async () => {
    mark(true);
    await importFile(SUMMARY, daily("mdy"));
    await importFile(TRANSACTIONS, daily("dmy", "Transaction ID"));
    db.tables.sales_days.push({ id: "z1", restaurant_id: R, day: "2026-10-31", net_sales: 999, source: "z_report" });
    db.tables.sales_days = db.tables.sales_days.filter((d) => !(d.day === "2026-10-31" && d.source === "pos"));
    const { importsFor } = await import("@/lib/pilot-zero-sales");
    const uploads = await importsFor(R);
    expect(uploads.map((u) => u.file_name)).toEqual([TRANSACTIONS, SUMMARY]);

    expect(await remove({ importId: uploads[0].id })).toEqual({ from: "2026-09-20", to: "2026-10-31", days: 41, items: 0, uploads: 1 });
    expect(db.tables.sales_days.filter((d) => d.day >= "2026-09-20")).toEqual([expect.objectContaining({ id: "z1", source: "z_report" })]);
    expect(db.tables.pos_imports.find((i) => i.id === uploads[0].id)).toMatchObject({ status: "cancelled", error: expect.stringMatching(/Removed by the builder/) });
    expect([...db.files.keys()].some((k) => k.endsWith(String(uploads[0].file_path)))).toBe(false);
    expect([...db.files.keys()].some((k) => k.endsWith(String(uploads[1].file_path)))).toBe(true);

    expect(await remove({ from: "2025-11-01", to: "2026-10-31" })).toMatchObject({ days: 319, uploads: 1 });
    expect(db.tables.sales_days).toEqual([expect.objectContaining({ id: "z1" })]); // only the till report is left
    expect(db.tables.audit_log.filter((a) => a.action === "sales_removed").map((a) => a.actor)).toEqual(["builder", "builder"]);
  });

  test("refused, changing nothing: the wrong name typed, a restaurant not marked for Pilot Zero, a backwards range", async () => {
    mark(true);
    await importFile(SUMMARY, daily("mdy"));
    await expect(remove({ from: "2025-11-01", to: "2026-10-31" }, "Pilot Zero")).rejects.toThrow(/type the restaurant's name exactly \(Pilot Zero Food Hall\)/);
    await expect(remove({ from: "2026-10-31", to: "2025-11-01" })).rejects.toThrow(/start first/);
    mark(false);
    await expect(remove({ from: "2025-11-01", to: "2026-10-31" })).rejects.toThrow(/isn't marked for Pilot Zero/);
    expect(db.tables.sales_days).toHaveLength(361);
  });
});
