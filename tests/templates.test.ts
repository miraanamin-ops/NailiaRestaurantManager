// The owner spreadsheets (5 Nov, not in onboarding yet): each one is built as a real
// Excel file, filled in the way an owner would (with ExcelJS, like typing in
// Excel), read back by plain code, and what comes out is checked. Set
// TEMPLATES_OUT=<folder> to also save the four blank files there for a look
// (TEMPLATES_RESTAURANT=<json> for a real restaurant's name, colour and menu).
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { applyCosts } from "@/lib/menu-engineering";
import type { MenuCategory } from "@/lib/onboarding/profile-data";
import { applyMapping, mappingWorks, type PosMapping } from "@/lib/sales/pos-table";
import { readDailyTakings, readMenuCosts, readStaff, roleFrom } from "@/lib/templates/read";
import { readTemplateTable } from "@/lib/templates/read-file";
import { ALL_OTHER_DISHES, DAILY_TAKINGS_MAPPING, dailyTakingsSpec, menuCostsSpec, salesExampleSpec, staffSpec } from "@/lib/templates/specs";
import { buildWorkbook } from "@/lib/templates/workbook";

const menu: MenuCategory[] = [
  { category: "Grills", items: [{ name: "Lamb Chops", price: 14.4, description: null }, { name: "Mixed Grill", price: 18, description: null }, { name: "Chicken Wings", price: 6, description: null }] },
  { category: "Drinks", items: [{ name: "Mango Lassi", price: 3.6, description: null }] },
];
const restaurant = { name: "Ember & Spice Grill", brand_color: "#7b1e3a", menu };

// Opens a built file, lets the test "type" into it, and saves it again.
async function fill(buf: Buffer, sheet: string, edit: (ws: ExcelJS.Worksheet) => void) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  edit(wb.getWorksheet(sheet)!);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("the files themselves", () => {
  test("each opens on its data tab, with the instructions tab second, headings in the restaurant's colour and dropdowns", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildWorkbook(staffSpec(restaurant))) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Your team", "How to fill this in"]);
    const ws = wb.getWorksheet("Your team")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Name", "Role", "Hourly rate (£)", "Contracted hours a week", "Days they can work", "Times they can work", "Most hours a week"]);
    expect((ws.getCell("A1").fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FF7B1E3A");
    expect(ws.getCell("B4").dataValidation).toMatchObject({ type: "list", formulae: ['"Kitchen,Front of house,Delivery,Manager"'] });
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  test("save them for a look (only with TEMPLATES_OUT)", async () => {
    const out = process.env.TEMPLATES_OUT;
    if (!out) return;
    fs.mkdirSync(out, { recursive: true });
    // TEMPLATES_RESTAURANT=<json file with name, brand_color, menu>: a real restaurant's menu instead of the test one.
    const r = process.env.TEMPLATES_RESTAURANT ? JSON.parse(fs.readFileSync(process.env.TEMPLATES_RESTAURANT, "utf8")) : restaurant;
    for (const spec of [menuCostsSpec(r), staffSpec(r), salesExampleSpec(), dailyTakingsSpec(r, "2026-11-05")]) {
      fs.writeFileSync(path.join(out, spec.fileName), await buildWorkbook(spec));
    }
  });
});

describe("menu and costs", () => {
  test("pre-filled with their dishes; costs in £ or %, exact or estimate, sellers and 'all other dishes' come back", async () => {
    const spec = menuCostsSpec(restaurant);
    expect(spec.rows.map((r) => r[1])).toEqual(["Lamb Chops", "Mixed Grill", "Chicken Wings", "Mango Lassi", ALL_OTHER_DISHES]);
    const filled = await fill(await buildWorkbook(spec), "Your menu", (ws) => {
      ws.getCell("D2").value = "4.20";
      ws.getCell("E2").value = "Exact";
      ws.getCell("F2").value = "Best seller";
      ws.getCell("D3").value = 7.5; // typed as a number
      ws.getCell("F4").value = "Slow seller";
      ws.getCell("D6").value = "30%";
    });
    const table = await readTemplateTable(filled, "Your menu");
    const read = readMenuCosts(table!);
    expect(read).toEqual({
      costs: [
        { dish: "Lamb Chops", cost: "4.20", estimated: false },
        { dish: "Mixed Grill", cost: "7.5", estimated: true },
      ],
      rest_percent: 30,
      top: ["Lamb Chops"],
      slow: ["Chicken Wings"],
      problems: [],
    });
    const costed = applyCosts(menu, read).menu.flatMap((c) => c.items);
    expect(costed.map((i) => [i.name, i.cost, i.cost_estimated, i.seller ?? null])).toEqual([
      ["Lamb Chops", 4.2, false, "top"],
      ["Mixed Grill", 7.5, true, null],
      ["Chicken Wings", 1.8, true, "slow"],
      ["Mango Lassi", 1.08, true, null],
    ]);
  });

  test("costs already saved are filled in; an untouched sheet or someone else's file is a problem, not a guess", async () => {
    const saved = applyCosts(menu, { costs: [{ dish: "Lamb Chops", cost: "4.2", estimated: false }], top: ["Mixed Grill"] }).menu;
    expect(menuCostsSpec({ ...restaurant, menu: saved }).rows[0]).toEqual(["Grills", "Lamb Chops", 14.4, 4.2, "Exact", null]);
    expect(menuCostsSpec({ ...restaurant, menu: saved }).rows[1][5]).toBe("Best seller");
    const blank = await readTemplateTable(await buildWorkbook(menuCostsSpec(restaurant)), "Your menu");
    expect(readMenuCosts(blank!).problems).toEqual(["nothing was filled in yet"]);
    expect(readMenuCosts({ headers: ["Item", "Price"], rows: [] }).problems[0]).toMatch(/^this isn't the menu costs sheet/);
  });
});

describe("staff", () => {
  test("the example rows are ignored; roles in the owner's words; blanks mean any day or time", async () => {
    const filled = await fill(await buildWorkbook(staffSpec(restaurant)), "Your team", (ws) => {
      ws.getRow(4).values = ["Bilal", "Kitchen", 12.5, 35, "Mon-Fri", "Evenings", null];
      ws.getRow(5).values = ["Zara", "waitress", "£11.44", null, "Weekends", null, 16];
      ws.getRow(6).values = ["Omar", "boss", 15, 40, null, null, null];
    });
    const read = readStaff((await readTemplateTable(filled, "Your team"))!);
    expect(read.staff).toEqual([
      { name: "Bilal", role: "kitchen", hourly_rate: 12.5, contracted_hours: 35, days: "Mon-Fri", times: "Evenings", max_hours: null },
      { name: "Zara", role: "front", hourly_rate: 11.44, contracted_hours: null, days: "Weekends", times: null, max_hours: 16 },
    ]);
    expect(read.problems).toEqual(['Omar\'s role ("boss") isn\'t Kitchen, Front of house, Delivery or Manager']);
    expect(roleFrom("Front of house")).toBe("front");
    expect(roleFrom("Delivery driver")).toBe("delivery");
    const untouched = readStaff((await readTemplateTable(await buildWorkbook(staffSpec(restaurant)), "Your team"))!);
    expect(untouched).toEqual({ staff: [], problems: ["nobody was filled in yet (the grey example rows are ignored)"] });
  });
});

describe("sales", () => {
  test("daily takings: 12 months of dates filled in; what they type comes back, blank days left out, orders optional", async () => {
    const spec = dailyTakingsSpec(restaurant, "2026-11-05");
    expect(spec.rows).toHaveLength(365);
    const filled = await fill(await buildWorkbook(spec), "Daily takings", (ws) => {
      ws.getCell("B2").value = 1840.5; // 4 Nov
      ws.getCell("C2").value = 96;
      ws.getCell("B3").value = 1210; // 3 Nov, orders unknown
    });
    const table = (await readTemplateTable(filled, "Daily takings"))!;
    expect(readDailyTakings(table)).toEqual({
      days: [
        { day: "2026-11-03", takings: 1210, orders: null },
        { day: "2026-11-04", takings: 1840.5, orders: 96 },
      ],
      problems: [],
    });
    // The sales importer's own mapping drops a daily row with no order count (why this sheet has its own reader).
    expect(applyMapping(table, DAILY_TAKINGS_MAPPING).lines.map((l) => l.day)).toEqual(["2026-11-04"]);
    const untouched = await readTemplateTable(await buildWorkbook(spec), "Daily takings");
    expect(readDailyTakings(untouched).problems).toEqual(["no takings were filled in yet"]);
  });

  test("the example till export is one row per dish sold, and reads with a normal item mapping", async () => {
    const table = (await readTemplateTable(await buildWorkbook(salesExampleSpec()), "Example export"))!;
    const mapping: PosMapping = { date: "Date", time: "Time", item: "Item", quantity: "Quantity", price: "Net sales (£)", price_is: "line_total", receipt: "Receipt no.", date_order: "dmy", amount_basis: "net" };
    expect(mappingWorks(table, mapping)).toBe(true);
    expect(applyMapping(table, mapping).lines).toHaveLength(12);
  });
});
