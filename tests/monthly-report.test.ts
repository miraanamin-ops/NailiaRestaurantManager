// The monthly report's numbers (lib/report/monthly-rules.ts) on the Pilot Zero year
// (pilot-zero/): like-for-like comparisons, what moved the month (with the calendar's
// reasons), closures, the week and hours, dishes, and the sections left out when
// their data isn't there.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { MetricsData } from "@/lib/agents/insights-metrics";
import { daysOf, fallbackHighlights, fallbackWords, monthFor, notIncluded, monthlyFacts, monthlyFigures, monthlyWhatsApp, monthPrompt, monthStep, previousMonth, type MonthlyReportData } from "@/lib/report/monthly-rules";
import { parseCommand } from "@/lib/bot/parse";
import { parseCsv } from "@/lib/sales/pos-table";

const csv = (name: string) => {
  const [head, ...rows] = parseCsv(readFileSync(`pilot-zero/${name}`, "utf8"));
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};
const money = (s: string) => Number(s.replace(/[£,]/g, ""));
const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const fromMdy = (s: string) => {
  const [m, d, y] = s.replace(",", "").split(" ");
  return `${y}-${MON[m]}-${d.padStart(2, "0")}`;
};
const fromDmy = (s: string) => s.split("/").reverse().join("-");

// The year as the app would hold it after the three imports.
function pilotData(opts: { withItems?: boolean; withHours?: boolean } = {}): MetricsData {
  const days = new Map(csv("square-sales-summary-12-months.csv").map((r) => [fromMdy(r.Date), { day: fromMdy(r.Date), net: money(r["Net Sales"]), gross: null as number | null, transactions: null as number | null, source: "pos" }]));
  const hours = new Map<string, number>();
  const tx = csv("square-transactions-6-weeks.csv");
  const ids = new Map<string, Set<string>>();
  for (const r of tx) {
    const day = fromDmy(r.Date);
    if (money(r["Net Sales"]) > 0) ids.set(day, (ids.get(day) ?? new Set()).add(r["Transaction ID"]));
    const k = `${day}|${Number(r.Time.slice(0, 2))}`;
    hours.set(k, (hours.get(k) ?? 0) + money(r["Gross Sales"]));
  }
  for (const [day, s] of ids) days.get(day)!.transactions = s.size;
  return {
    today: "2026-11-02",
    sales_days: [...days.values()],
    sales_hours: opts.withHours === false ? [] : [...hours].map(([k, sales]) => ({ day: k.split("|")[0], hour: Number(k.split("|")[1]), sales })),
    sales_items: opts.withItems === false ? [] : csv("square-item-sales-6-weeks.csv").map((r) => ({ day: fromDmy(r.Date), item: r.Item, quantity: Number(r.Qty), amount: money(r["Gross Sales"]) })),
    weather: [{ day: "2026-10-14", temp_max: 13, temp_min: 9, rain_mm: 18, conditions: "rain" }],
    reviews: [
      { date: "2026-10-03T12:00:00Z", rating: 5, replied_at: null },
      { date: "2026-10-20T12:00:00Z", rating: 4, replied_at: null },
    ],
    signups: [],
    campaigns: [],
    sends: [],
    rewards: [],
    labour_weeks: [{ week_start: "2026-10-26", status: "published", cost: 2600, hours: 200, by_day: { "2026-10-26": 380, "2026-10-27": 370, "2026-10-28": 360, "2026-10-29": 370, "2026-10-30": 380, "2026-10-31": 420 }, missing_rates: 0 }],
    labour_target_pct: 28,
  };
}

describe("the month's numbers", () => {
  test("which month, and its days", () => {
    expect(previousMonth("2026-11-02")).toBe("2026-10");
    expect(previousMonth("2027-01-01")).toBe("2026-12");
    expect(daysOf("2026-02")).toHaveLength(28);
  });

  test("March 2026: Ramadan and Eid; like for like against February; Eid named as what moved it", () => {
    const calendar = [{ day: "2026-03-20", name: "Eid al-Fitr", type: "religious" }];
    const f = monthlyFigures({ data: pilotData({ withItems: false, withHours: false }), month: "2026-03", calendar })!;
    expect(f.label).toBe("March 2026");
    expect(f.traded).toBe(31);
    expect(f.vsLastMonth?.label).toBe("February 2026");
    expect(f.vsLastMonth!.likeForLike!).toBeGreaterThan(5); // Ramadan evenings and Eid
    expect(f.vsLastYear).toBeNull(); // no March 2025 in the data
    expect(f.movers[0]).toMatchObject({ day: "2026-03-20", reason: "Eid al-Fitr" });
    expect(f.movers[0].diff).toBeGreaterThan(1000);
    expect(f.hours).toBeNull();
    expect(f.dishes).toBeNull();
    expect(f.missing).toEqual(expect.arrayContaining([expect.stringMatching(/^Busiest and quietest hours: needs sales with times/), expect.stringMatching(/^Your dishes: needs a dish-by-dish export/)]));
  });

  test("July 2026: the three closed days are found, with what a usual day takes", () => {
    const f = monthlyFigures({ data: pilotData({ withItems: false, withHours: false }), month: "2026-07", calendar: [] })!;
    expect(f.closures.map((c) => c.day)).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
    expect(f.closures[0].usual).toBeGreaterThan(800);
  });

  test("October 2026: orders and average order, the week's shape, the hours, the dishes, labour and reviews", () => {
    const f = monthlyFigures({ data: pilotData(), month: "2026-10", calendar: [{ day: "2026-10-26", name: "Half term (Redbridge)", type: "school_holiday" }] })!;
    expect(f.orders).toBeGreaterThan(3000);
    expect(f.avgOrder).toBeGreaterThan(10);
    const avg = Object.fromEntries(f.weekdays.map((w) => [w.weekday, w.avg!]));
    expect(avg.Sat).toBeGreaterThan(avg.Tue * 2);
    expect(f.hours?.busiest).toBe("Fri 1pm to 2pm"); // the doubled lunch after Friday prayers (make-files.mjs)
    expect(f.hours?.grid.find((g) => g.weekday === "Fri")!.hours.length).toBeGreaterThan(8);
    expect(f.dishes!.top).toHaveLength(5);
    expect(f.dishes!.top[0].amount).toBeGreaterThan(f.dishes!.top[4].amount);
    expect(f.dishes!.topShare).toBeGreaterThan(20);
    expect(f.labour).toMatchObject({ cost: 2280, target: 28, days: 6 });
    expect(f.labour!.pct).toBeGreaterThan(15); // against those 6 days' takings, not the whole month's
    expect(f.reviews).toEqual({ count: 2, average: 4.5 });
    expect(f.missing).not.toContain(expect.stringMatching(/dishes/));
  });

  test("the facts for Claude are the numbers only (no rows, no names of customers); code's fallback is never blank", () => {
    const f = monthlyFigures({ data: pilotData(), month: "2026-10", calendar: [] })!;
    const facts = monthlyFacts(f, "Maison Noor");
    expect(facts).toMatch(/^Maison Noor, October 2026: £[\d,]+ net over 31 trading days, \d+ orders/);
    expect(facts).toMatch(/vs September 2026: [-\d.]+% raw, [-\d.]+% like for like/);
    const words = fallbackWords(f);
    expect(words.headline).toMatch(/^£[\d,]+ net in October, (up|down) [\d.]+% on September like for like\.$/);
    expect(words.actions).toHaveLength(3);
    for (const t of [facts, words.headline, ...words.actions]) expect(t).not.toMatch(/[—–]/);
  });

  test("only real causes count as a day's reason: not the hundreds of shows in the events feed, and each name once", () => {
    const shard = Array.from({ length: 40 }, () => ({ day: "2026-10-30", name: "The View from The Shard (The View from The Shard)", type: "local_event" }));
    const calendar = [...shard, { day: "2026-10-30", name: "Arsenal v Leeds", type: "football" }, { day: "2026-10-30", name: "Payday (last working day)", type: "payday" }, { day: "2026-10-30", name: "Half term (Redbridge)", type: "school_holiday" }, { day: "2026-10-30", name: "Half term (Newham)", type: "school_holiday" }];
    const f = monthlyFigures({ data: pilotData({ withItems: false, withHours: false }), month: "2026-10", calendar })!;
    const fri = f.movers.find((m) => m.day === "2026-10-30");
    expect(fri?.reason).toBe("Payday, Half term");
    const plain = monthlyFigures({ data: pilotData({ withItems: false, withHours: false }), month: "2026-10", calendar: shard })!;
    expect(plain.movers.find((m) => m.day === "2026-10-30")?.reason).toMatch(/^No obvious reason/);
  });

  test("code's own key messages: 3 or 4, none repeating the headline numbers", () => {
    const f = monthlyFigures({ data: pilotData(), month: "2026-10", calendar: [] })!;
    const h = fallbackHighlights(f);
    expect(h.length).toBeGreaterThanOrEqual(3);
    expect(h.length).toBeLessThanOrEqual(4);
    expect(h.map((x) => x.title)).toEqual(expect.arrayContaining([expect.stringMatching(/ is your big day$/), expect.stringMatching(/ leads the menu$/)]));
    expect(h.some((x) => x.detail.includes(f.orders!.toLocaleString("en-GB")))).toBe(false);
    expect(notIncluded(f)).toMatch(/^Not included yet: compared with October 2025/);
  });

  test("a month with no figures at all has no report", () => {
    expect(monthlyFigures({ data: pilotData(), month: "2027-01", calendar: [] })).toBeNull();
  });
});

describe("the end of the month", () => {
  const at = (today: string, o: { reportExists?: boolean; lastDayCovered?: boolean; hasSales?: boolean } = {}) =>
    monthStep({ today, reportExists: false, lastDayCovered: false, hasSales: true, ...o });

  test("last day: ask for the month's export; 1st and 3rd: remind; once it's in (or the 4th): make it; then nothing", () => {
    expect(at("2026-11-30")).toEqual({ kind: "ask", month: "2026-11" });
    expect(at("2026-02-28")).toEqual({ kind: "ask", month: "2026-02" });
    expect(at("2026-12-01")).toEqual({ kind: "remind", month: "2026-11" });
    expect(at("2026-12-02")).toEqual({ kind: "none" }); // no nagging every day
    expect(at("2026-12-03")).toEqual({ kind: "remind", month: "2026-11" });
    expect(at("2026-12-04")).toEqual({ kind: "make", month: "2026-11" }); // with what there is
    expect(at("2026-12-02", { lastDayCovered: true })).toEqual({ kind: "make", month: "2026-11" });
    expect(at("2026-12-02", { lastDayCovered: true, reportExists: true })).toEqual({ kind: "none" });
    expect(at("2026-12-05")).toEqual({ kind: "none" });
    expect(at("2026-11-15")).toEqual({ kind: "none" });
  });

  test("a restaurant that never sends sales isn't asked", () => {
    expect(at("2026-11-30", { hasSales: false })).toEqual({ kind: "none" });
    expect(at("2026-12-04", { hasSales: false })).toEqual({ kind: "none" });
  });

  test("the prompts say how to export from Square and where to upload; no dashes", () => {
    const ask = monthPrompt({ kind: "ask", month: "2026-11" }, "https://app.dinerai.co.uk/sales?r=x");
    expect(ask).toMatch(/^📊 Tomorrow I'll write your November report/);
    expect(ask).toContain("Item sales");
    expect(ask).toContain("https://app.dinerai.co.uk/sales?r=x");
    const remind = monthPrompt({ kind: "remind", month: "2026-11" }, "u");
    expect(remind).toMatch(/If it isn't in by the 4th/);
    for (const t of [ask, remind]) expect(t).not.toMatch(/[—–]/);
  });

  test("MONTHLY REPORT: last month, or the latest finished month with that name", () => {
    expect(parseCommand("monthly report", 1)).toEqual({ name: "monthly_report", month: null });
    expect(parseCommand("Monthly", 1)).toEqual({ name: "monthly_report", month: null });
    expect(parseCommand("MONTHLY REPORT SEPTEMBER", 1)).toEqual({ name: "monthly_report", month: 9 });
    expect(parseCommand("monthly report sept", 1)).toEqual({ name: "monthly_report", month: 9 });
    expect(parseCommand("monthly report for oct", 1)).toEqual({ name: "monthly_report", month: 10 });
    expect(parseCommand("monthly report banana", 1)).toBeNull();
    expect(monthFor("2026-11-02", null)).toBe("2026-10");
    expect(monthFor("2026-11-02", 10)).toBe("2026-10");
    expect(monthFor("2026-11-02", 11)).toBe("2025-11"); // this November isn't finished
    expect(monthFor("2026-11-02", 12)).toBe("2025-12");
  });

  test("the PDF renders (October, every section) and the WhatsApp line carries the headline and link", async () => {
    const { renderMonthlyPdf } = await import("@/lib/report/monthly-pdf");
    const figures = monthlyFigures({ data: pilotData(), month: "2026-10", calendar: [] })!;
    const data: MonthlyReportData = {
      kind: "monthly",
      version: 2,
      restaurant: { name: "Maison Noor", brandColor: "#c8a24a", brandDark: "#1d1a14" },
      figures,
      words: { headline: "£40,000 net in October.", highlights: [{ title: "Saturday is your big day", detail: "£2,849 on average." }], actions: [1, 2, 3].map((i) => ({ title: `Action ${i}`, why: "Because.", message: "Do it" })) },
      whatsappNumber: "14155238886",
      simulated: null,
    };
    const pdf = await renderMonthlyPdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3000);
    expect(monthlyWhatsApp(data, "https://x/report/t")).toBe("📊 *October 2026 at Maison Noor*\n£40,000 net in October.\n🔗 https://x/report/t");
  }, 30_000);
});
