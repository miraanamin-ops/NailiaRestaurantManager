// Sales: the plain-code rules. Till report checks and wording, replies, POS
// file reading and column mapping, the report's Sales section, and weather.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCommand } from "@/lib/bot/parse";
import { changeText, formatValue } from "@/lib/report/types";
import { isTestCommand } from "@/lib/test-mode";
import { undoPlan } from "@/lib/undo-plan";
import { addDays, dayLabel, gbp } from "@/lib/sales/format";
import {
  applyMapping,
  dayTotals,
  layoutSignature,
  mappingWorks,
  parseCsv,
  parseDate,
  parseHour,
  parseMoney,
  rowKeys,
  sampleForAi,
  toTable,
  type PosMapping,
} from "@/lib/sales/pos-table";
import { buildSalesSection, salesFacts, type SalesDayRow } from "@/lib/sales/report-section";
import { conditionsFor, postcodeOf, townOf, weatherRows } from "@/lib/sales/weather-data";
import {
  checkZReport,
  closedOn,
  confirmQuestion,
  needsZNudge,
  parseSalesReply,
  replaceQuestion,
  sameFigures,
  savedLine,
  type ZRead,
} from "@/lib/sales/z-check";

const TODAY = "2026-10-10"; // a Saturday

const read = (over: Partial<ZRead> = {}): ZRead => ({
  is_till_report: true,
  business_date: "2026-10-08",
  gross_sales: 2808,
  net_sales: 2340,
  vat: 468,
  transactions: 118,
  card: 2312.4,
  cash: 495.6,
  other_payments: null,
  discounts: 42.5,
  refunds: 0,
  hourly: [],
  unclear: [],
  ...over,
});

describe("till reports: do the numbers add up?", () => {
  test("a clean report is saved with the one-line confirmation", () => {
    const c = checkZReport(read(), TODAY);
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    expect(savedLine(c.figures, TODAY)).toBe("Thu 8 Oct: £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions. Saved.");
  });

  test("card plus cash not matching the total asks the sender to confirm", () => {
    const c = checkZReport(read({ cash: 355.6 }), TODAY);
    expect(c.status).toBe("needs_confirm");
    if (c.status !== "needs_confirm") return;
    expect(c.problems[0]).toMatch(/card £2,312.40 \+ cash £355.60 = £2,668.00, which is £140.00 less than the total £2,808.00/);
    const q = confirmQuestion(c.figures, c.problems, TODAY);
    expect(q).toMatch(/Thu 8 Oct/);
    expect(q).toMatch(/Reply \*YES\* to save it as it is, or send a clearer photo/);
  });

  test("payments matching the total after refunds are fine", () => {
    expect(checkZReport(read({ refunds: 20, cash: 475.6 }), TODAY).status).toBe("ok");
  });

  test("net plus VAT not matching gross is flagged", () => {
    const c = checkZReport(read({ vat: 400 }), TODAY);
    expect(c.status).toBe("needs_confirm");
    if (c.status === "needs_confirm") expect(c.problems.join(" ")).toMatch(/net £2,340.00 \+ VAT £400.00/);
  });

  test("missing figures are worked out from the others, or estimated at 20% VAT", () => {
    const derived = checkZReport(read({ net_sales: null }), TODAY);
    expect(derived.status === "ok" && derived.figures.net_sales).toBe(2340);
    const estimated = checkZReport(read({ net_sales: null, vat: null }), TODAY);
    expect(estimated.status === "ok" && estimated.figures.net_estimated).toBe(true);
    if (estimated.status === "ok") expect(savedLine(estimated.figures, TODAY)).toBe(
        "Thu 8 Oct: £2,808.00 sales, £2,340.00 net (no VAT on the report, so worked out at 20%), 118 transactions. Saved.",
      );
  });

  test("no date asks which day; no totals asks for a clearer photo; not a till report is passed on", () => {
    expect(checkZReport(read({ business_date: null }), TODAY).status).toBe("needs_date");
    expect(checkZReport(read({ net_sales: null, gross_sales: null, vat: null }), TODAY).status).toBe("unreadable");
    expect(checkZReport(read({ is_till_report: false }), TODAY).status).toBe("not_report");
  });

  test("hourly sales that don't add up, odd dates and unclear figures need confirming", () => {
    const hourly = checkZReport(read({ hourly: [{ hour: 18, sales: 900 }, { hour: 19, sales: 800 }] }), TODAY);
    expect(hourly.status === "needs_confirm" && hourly.problems[0]).toMatch(/hourly sales add up to £1,700.00/);
    const okHourly = checkZReport(read({ hourly: [{ hour: 18, sales: 1500 }, { hour: 19, sales: 1308 }] }), TODAY);
    expect(okHourly.status).toBe("ok");
    expect(checkZReport(read({ business_date: "2026-10-12" }), TODAY).status).toBe("needs_confirm"); // the future
    expect(checkZReport(read({ business_date: "2026-07-01" }), TODAY).status).toBe("needs_confirm"); // months ago
    const unclear = checkZReport(read({ unclear: ["the cash total"] }), TODAY);
    expect(unclear.status === "needs_confirm" && unclear.problems).toContain("I wasn't sure about the cash total");
  });

  test("a second report for the same day asks to replace, unless the numbers are the same", () => {
    const c = checkZReport(read(), TODAY);
    if (c.status !== "ok") throw new Error("expected ok");
    expect(sameFigures(c.figures, { net_sales: 2340, transactions: 118 })).toBe(true);
    expect(sameFigures(c.figures, { net_sales: 2300, transactions: 110 })).toBe(false);
    expect(replaceQuestion(c.figures, { gross_sales: 2760, vat: 460, net_sales: 2300, transactions: 110, net_estimated: false }, TODAY)).toBe(
      "🧾 You already sent a report for *Thu 8 Oct* (£2,760.00 sales, £460.00 VAT, £2,300.00 net, 110 transactions). This one says £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions.\nReplace the earlier one? Reply *REPLACE* or *KEEP*.",
    );
  });
});

describe("answers to till report questions", () => {
  test("yes, no, replace and keep", () => {
    for (const t of ["YES", "yes.", "ok", "Save it"]) expect(parseSalesReply(t, TODAY)).toEqual({ kind: "yes" });
    for (const t of ["no", "Cancel"]) expect(parseSalesReply(t, TODAY)).toEqual({ kind: "no" });
    expect(parseSalesReply("REPLACE", TODAY)).toEqual({ kind: "replace" });
    expect(parseSalesReply("keep the old one", TODAY)).toEqual({ kind: "keep" });
    expect(parseSalesReply("what were sales yesterday?", TODAY)).toBeNull();
  });

  test("dates in the ways people type them", () => {
    const date = (t: string) => {
      const r = parseSalesReply(t, TODAY);
      return r?.kind === "date" ? r.ymd : null;
    };
    expect(date("yesterday")).toBe("2026-10-09");
    expect(date("9 Oct")).toBe("2026-10-09");
    expect(date("9th October")).toBe("2026-10-09");
    expect(date("Oct 9")).toBe("2026-10-09");
    expect(date("9/10")).toBe("2026-10-09");
    expect(date("09/10/2026")).toBe("2026-10-09");
    expect(date("thursday")).toBe("2026-10-08");
    expect(date("Sat")).toBe("2026-10-10"); // today
    expect(date("25 Dec")).toBe("2025-12-25"); // no year and in the future: last year
    expect(date("31/02")).toBeNull();
  });
});

describe("the morning brief nudge", () => {
  test("only for restaurants that send till reports, when yesterday is missing and they were open", () => {
    const base = { lastZDay: "2026-10-05", yesterdayHasSales: false, closedYesterday: false, today: TODAY };
    expect(needsZNudge(base)).toBe(true);
    expect(needsZNudge({ ...base, lastZDay: null })).toBe(false); // never sent one
    expect(needsZNudge({ ...base, lastZDay: "2026-09-01" })).toBe(false); // stopped using them
    expect(needsZNudge({ ...base, yesterdayHasSales: true })).toBe(false);
    expect(needsZNudge({ ...base, closedYesterday: true })).toBe(false);
    expect(closedOn({ Sunday: "Closed", Monday: "07:30 – 17:00" }, "2026-10-04")).toBe(true);
    expect(closedOn({ Sunday: "Closed", Monday: "07:30 – 17:00" }, "2026-10-05")).toBe(false);
  });
});

describe("POS files", () => {
  test("CSV with quotes, commas inside quotes and Windows line endings", () => {
    expect(parseCsv('a,b,c\r\n"x, y","say ""hi""",3\r\n')).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "3"],
    ]);
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("the heading row is found after a title, and money, dates and times are read", () => {
    const t = toTable(parseCsv("Sales export\nPeriod: Oct\n\nDate,Item,Qty,Total\n09/10/2026,Lamb,1,13.95\n"));
    expect(t?.headers).toEqual(["Date", "Item", "Qty", "Total"]);
    expect(t?.rows).toHaveLength(1);
    expect(parseMoney("£1,234.50")).toBe(1234.5);
    expect(parseMoney("(3.00)")).toBe(-3);
    expect(parseMoney("12,50")).toBe(12.5);
    expect(parseMoney("abc")).toBeNull();
    expect(parseDate("09/10/2026 18:42", "dmy")).toEqual({ day: "2026-10-09", hour: 18 });
    expect(parseDate("10/09/2026", "mdy")).toEqual({ day: "2026-10-09", hour: null });
    expect(parseDate("2026-10-09T17:42:00Z", "dmy")).toEqual({ day: "2026-10-09", hour: 18 }); // UTC -> London summer time
    expect(parseDate("Fri 9 Oct 2026", "dmy")?.day).toBe("2026-10-09");
    expect(parseDate(46304.75, "dmy")).toEqual({ day: "2026-10-09", hour: 18 }); // an Excel date and time
    expect(parseDate(new Date(Date.UTC(2026, 9, 9)), "dmy")).toEqual({ day: "2026-10-09", hour: null });
    expect(parseHour("6:42 PM")).toBe(18);
    expect(parseHour(0.5)).toBe(12);
  });

  const SAMPLE_MAPPING: PosMapping = {
    date: "Date",
    time: "Time",
    item: "Item",
    quantity: "Qty",
    price: "Line Total",
    price_is: "line_total",
    receipt: "Receipt No",
    date_order: "dmy",
  };

  test("the sample POS export reads with the right columns, and the totals row is skipped", () => {
    const table = toTable(parseCsv(readFileSync("public/samples/pos-export-sample.csv", "utf8")))!;
    expect(table.headers.slice(0, 5)).toEqual(["Date", "Time", "Receipt No", "Category", "Item"]);
    expect(mappingWorks(table, SAMPLE_MAPPING)).toBe(true);
    const { lines, skipped } = applyMapping(table, SAMPLE_MAPPING);
    expect(lines).toHaveLength(522);
    expect(skipped).toBe(1); // the "Total" row
    const days = dayTotals(lines);
    expect(days.map((d) => d.day)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(Math.round(days.reduce((s, d) => s + d.gross, 0) * 100) / 100).toBe(4571.25);
    expect(days.reduce((s, d) => s + (d.transactions ?? 0), 0)).toBe(212);
    expect(days[0].hours[0].hour).toBe(12);
    // A wrong mapping (the price column is the staff name) doesn't "work".
    expect(mappingWorks(table, { ...SAMPLE_MAPPING, price: "Staff" })).toBe(false);
  });

  test("the AI never sees staff, customer or contact details", () => {
    const table = toTable(parseCsv("Date,Item,Total,Staff,Customer Email,Note\n09/10/2026,Lamb,13.95,Yusuf,a@b.com,call 07700900123\n"))!;
    const sample = sampleForAi(table);
    expect(sample.rows[0]).toEqual(["09/10/2026", "Lamb", "13.95", "[hidden]", "[hidden]", "[number]"]);
  });

  test("unit prices are multiplied by the quantity", () => {
    const table = toTable(parseCsv("Date,Item,Qty,Each\n09/10/2026,Lassi,3,3.95\n09/10/2026,Naan,2,2.95\n"))!;
    const { lines } = applyMapping(table, { date: "Date", time: null, item: "Item", quantity: "Qty", price: "Each", price_is: "unit_price", receipt: null, date_order: "dmy" });
    expect(lines.map((l) => l.amount)).toEqual([11.85, 5.9]);
  });

  test("the same lines get the same fingerprints (so a re-upload is skipped); repeated lines stay distinct", () => {
    const line = { day: "2026-10-09", hour: 18, item: "Latte", quantity: 1, amount: 3.85, receipt: null };
    const a = rowKeys([line, line]);
    expect(a[0]).not.toBe(a[1]);
    expect(rowKeys([line, line])).toEqual(a);
    expect(layoutSignature(["Date", "Item "])).toBe(layoutSignature(["date", "item"]));
  });
});

describe("the weekly report's Sales section", () => {
  const WEEK = "2026-10-05"; // Monday
  const day = (d: string, net: number, transactions: number | null = 100): SalesDayRow => ({ day: d, net_sales: net, transactions, net_estimated: false, is_dummy: false });

  test("left out when there are no sales figures", () => {
    expect(buildSalesSection(WEEK, [], [])).toBeNull();
    expect(buildSalesSection(WEEK, [day("2026-09-01", 500)], [])).toBeNull(); // too long ago
  });

  test("totals, comparisons, best and worst day, average spend and top items", () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => day(addDays(WEEK, i), 1000 + i * 100)), // last week: 1000..1600
      ...Array.from({ length: 7 }, (_, i) => day(addDays(WEEK, i - 7), 1000)), // the week before
      ...Array.from({ length: 7 }, (_, i) => day(addDays(WEEK, i - 28), 900)), // a month ago
    ];
    const items = [
      { item: "Lamb Chops", quantity: 10, amount: 139.5 },
      { item: "Naan", quantity: 40, amount: 118 },
      { item: "lamb chops ", quantity: 2, amount: 27.9 }, // same dish, different spelling
      ...["A", "B", "C", "D"].map((n, i) => ({ item: n, quantity: 1, amount: 10 - i })),
    ];
    const s = buildSalesSection(WEEK, rows, items)!;
    expect(s.net).toEqual({ now: 9100, before: 7000 });
    expect(s.lastMonth).toBe(6300);
    expect(s.daily.values).toHaveLength(14);
    expect(s.daily.days[7]).toBe("Mon 5");
    expect(s.best).toEqual({ day: "Sun 11 Oct", amount: 1600 });
    expect(s.worst).toEqual({ day: "Mon 5 Oct", amount: 1000 });
    expect(s.avgSpend).toEqual({ now: 13, before: 10 });
    expect(s.topItems.map((t) => t.name)).toEqual(["Lamb Chops", "Naan", "A", "B", "C"]);
    expect(s.topItems[0]).toEqual({ name: "Lamb Chops", quantity: 12, amount: 167.4 });
    expect(s.daysWithData).toEqual({ now: 7, before: 7 });
    expect(salesFacts(s)).toMatch(/Net sales £9100 \(week before £7000, \+30%\)/);
  });

  test("money comparisons read naturally", () => {
    expect(changeText({ now: 9100, before: 7000 }, "money")).toBe("+£2,100 (+30%) vs the week before");
    expect(changeText({ now: 9100, before: 9100.2 }, "money")).toBe("same as the week before");
    expect(changeText({ now: 9100, before: 9800 }, "money", "the same week last month")).toBe("−£700 (−7%) vs the same week last month");
    expect(formatValue(14230.4, "money")).toBe("£14,230");
    expect(formatValue(19.4, "money")).toBe("£19.40");
    expect(gbp(2340)).toBe("£2,340");
    expect(dayLabel("2025-12-25", 2026)).toBe("Thu 25 Dec 2025");
  });
});

describe("weather", () => {
  test("Open-Meteo's answer becomes rows; today is still a forecast", () => {
    const json = {
      daily: {
        time: ["2026-10-09", "2026-10-10"],
        temperature_2m_max: [14.27, 16],
        temperature_2m_min: [8, 9],
        temperature_2m_mean: [11, null],
        precipitation_sum: [3.2, 0],
        weather_code: [61, 2],
      },
    };
    const rows = weatherRows(json, "recent", TODAY);
    expect(rows[0]).toMatchObject({ day: "2026-10-09", temp_max: 14.3, rain_mm: 3.2, conditions: "Light rain", source: "recent" });
    expect(rows[1]).toMatchObject({ temp_mean: null, conditions: "Partly cloudy", source: "forecast" });
    expect(conditionsFor(95)).toBe("Thunderstorm");
  });

  test("a restaurant is found by its postcode, or else its town", () => {
    expect(postcodeOf("214 Whitechapel Road, London E1 1BJ")).toBe("E1 1BJ");
    expect(postcodeOf("87 Cranbrook Road, Ilford IG1 4PG")).toBe("IG1 4PG");
    expect(postcodeOf("High Street, Leeds")).toBeNull();
    expect(townOf("214 Whitechapel Road, London E1 1BJ")).toBe("London");
    expect(townOf("12 High Street, Leeds, UK")).toBe("Leeds");
  });
});

describe("sales commands", () => {
  test("staff numbers, the sales page and the sample till reports", () => {
    expect(parseCommand("ADD STAFF +447700900123", 6)).toEqual({ name: "add_staff", number: "+447700900123" });
    expect(parseCommand("remove staff 07700 900123", 6)).toEqual({ name: "remove_staff", number: "07700 900123" });
    expect(parseCommand("Staff", 6)).toEqual({ name: "staff" });
    expect(parseCommand("SALES", 6)).toEqual({ name: "sales" });
    expect(parseCommand("SAMPLE ZREPORT 2", 6)).toEqual({ name: "sample_z", sample: "2" });
    expect(parseCommand("test z-report bad", 6)).toEqual({ name: "test_z", sample: "bad" });
    expect(parseCommand("TEST Z", 6)).toEqual({ name: "test_z", sample: "1" });
    expect(parseCommand("TEST ZREPORT 7", 6)).toBeNull();
    expect(parseCommand("RUN WEATHER", 6)).toEqual({ name: "run_weather" });
    // Test commands only work in test mode; the owner's own commands always do.
    for (const name of ["sample_z", "test_z", "run_weather"]) expect(isTestCommand(name)).toBe(true);
    for (const name of ["add_staff", "remove_staff", "staff", "sales"]) expect(isTestCommand(name)).toBe(false);
  });

  test("UNDO reverses ADD STAFF and REMOVE STAFF", () => {
    expect(undoPlan({ action: "staff_added", data: { number: "whatsapp:+447700900123" } }, null, "dummy")).toEqual({
      type: "staff",
      number: "whatsapp:+447700900123",
      active: false,
    });
    expect(undoPlan({ action: "staff_removed", data: { number: "whatsapp:+447700900123" } }, null, "dummy")).toMatchObject({ active: true });
  });
});
