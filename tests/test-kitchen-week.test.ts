// Test Kitchen end to end on its dummy data (docs/pilot-sprint.md, "Finance
// forecast and calendar"): the real seed (supabase/seed/test-kitchen.sql) runs on
// the full migration chain in PGlite, its rows are copied into the in-memory
// stand-in, and the real brief and report code runs on them for a Monday:
// the week's forecast range, the rota's labour % against the owner's target,
// the calendar lines (a home match that moves the forecast, a bank holiday,
// the school-holiday note for a council we don't cover), a campaign idea with
// its buttons, and the Monday report's Last week, Google and Next week
// sections with 3 actions, under 25 lines on WhatsApp.
// SHOW_OUTPUT=1 prints the brief and the report message.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb } from "./support/full-pg";
import { memoryDb } from "./support/memory-db";

const TK = "7e57c0de-0000-4000-8000-000000000000";
const SEED = readFileSync(new URL("../supabase/seed/test-kitchen.sql", import.meta.url), "utf8");
const TABLES = ["restaurants", "sales_days", "sales_hours", "staff", "staff_pay_rates", "staff_availability", "rota_rules", "rota_weeks", "rota_shifts", "reviews", "local_calendar", "councils"];

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let pg: PGlite;
let monday: string; // the most recent Monday (today's London date if it's a Monday)
const rows: Record<string, Record<string, unknown>[]> = {};

beforeAll(async () => {
  pg = await newFullDb();
  await pg.exec(`do $$ begin execute format('comment on database %I is %s', current_database(), quote_literal('dinerai-dev: test')); end $$;`);
  await pg.exec(SEED);
  monday = (await pg.query<{ d: string }>("select date_trunc('week', current_date)::date::text as d")).rows[0].d;
  // Home matches: every other Saturday in the history traded 25% busier, and there's
  // one this Saturday. A bank holiday on Wednesday (a test row, not a real date).
  const saturday = addDays(monday, 5);
  for (let w = 2; w <= 40; w += 2) {
    const day = addDays(saturday, -7 * w);
    await pg.query("update sales_days set transactions = round(transactions * 1.25), net_sales = round(net_sales * 1.25, 2) where restaurant_id = $1 and day = $2", [TK, day]);
    await pg.query("insert into local_calendar (restaurant_id, day, name, type, source) values ($1, $2, 'West Ham v Spurs (home)', 'sport', 'builder')", [TK, day]);
  }
  await pg.query("insert into local_calendar (restaurant_id, day, name, type, source) values ($1, $2, 'West Ham v Fulham (home)', 'sport', 'builder')", [TK, saturday]);
  await pg.query("insert into local_calendar (restaurant_id, day, name, type, source) values (null, $1, 'Test bank holiday', 'bank_holiday', 'builder')", [addDays(monday, 2)]);
  // This week's rota: the Thursday draft (last week's pattern, a week on).
  const week = (await pg.query<{ id: string }>("insert into rota_weeks (restaurant_id, week_start, status, source) values ($1, $2, 'draft', 'model') returning id", [TK, monday])).rows[0].id;
  await pg.query(
    `insert into rota_shifts (restaurant_id, rota_week_id, staff_id, role, business_date, starts_at, ends_at, source)
     select restaurant_id, $3, staff_id, role, business_date + 7, starts_at + interval '7 days', ends_at + interval '7 days', 'model'
       from rota_shifts where restaurant_id = $1 and rota_week_id = (select id from rota_weeks where restaurant_id = $1 and week_start = $2)`,
    [TK, addDays(monday, -7), week],
  );
  for (const t of TABLES) rows[t] = (await pg.query<{ j: Record<string, unknown> }>(`select to_jsonb(t) as j from ${t} t`)).rows.map((r) => r.j);
}, 300_000);

async function load() {
  vi.resetModules();
  const db = memoryDb({ ...structuredClone(rows), restaurants: rows.restaurants.map((r) => (r.id === TK ? { ...r, labour_target_pct: 28, owner_whatsapp: "whatsapp:+447700900333" } : r)) });
  const sent: { text: string; buttons: unknown }[] = [];
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: vi.fn(async (_c: unknown, text: string, buttons: unknown) => void sent.push({ text, buttons })) }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: vi.fn(async (_k: string, m: string) => void sent.push({ text: `BUILDER: ${m}`, buttons: false })) }));
  vi.doMock("@/lib/agents/gm", async (orig) => ({ ...(await orig<object>()), queueGmBriefShadow: vi.fn(async () => {}) }));
  vi.doMock("@/lib/agents/insights", async (orig) => ({ ...(await orig<object>()), queueInsightsShadow: vi.fn(async () => {}), insightsMode: vi.fn(async () => "off") }));
  vi.doMock("@/lib/agents/reputation", async (orig) => ({ ...(await orig<object>()), weeklyThemesFor: vi.fn(async () => null) }));
  vi.doMock("@/lib/assistant", async (orig) => ({ ...(await orig<object>()), writeReportInsights: vi.fn(async () => { throw new Error("no AI in tests"); }) }));
  // postcodes.io: E1 6AN is in Tower Hamlets, a council whose term dates we don't hold.
  vi.doMock("@/lib/feeds/location", () => ({
    ensureLocated: vi.fn(async (r: { id: string }) => {
      Object.assign(db.tables.restaurants.find((x) => x.id === r.id)!, { council_code: "E09000030", council_name: "Tower Hamlets" });
      return { lat: 51.52, lon: -0.07, cell: "x", councilCode: "E09000030" };
    }),
  }));
  const { sendBrief } = await import("@/lib/brief");
  const { createReport, reportPeriod } = await import("@/lib/report/build");
  const { loadRestaurantContext } = await import("@/lib/assistant");
  return { db, sent, sendBrief, createReport, reportPeriod, loadRestaurantContext };
}

const show = (title: string, text: string) => {
  if (process.env.SHOW_OUTPUT) console.log(`\n===== ${title} =====\n${text}\n`);
};

describe("Test Kitchen on a Monday, on its dummy data", () => {
  test("the morning brief: this week's forecast and labour, the calendar lines, one campaign idea", async () => {
    const now = new Date(`${monday}T09:05:00Z`);
    const t = await load();
    const restaurant = t.db.tables.restaurants.find((r) => r.id === TK)!;
    const out = await t.sendBrief(restaurant as never, { from: "whatsapp:+14155238886", to: "whatsapp:+447700900333" } as never, now);
    expect(out.sent).toBe(true);
    const brief = t.sent[0].text;
    show("Morning brief", brief);
    expect(brief).toMatch(/💷 \*This week\*\nSales forecast £[\d.,k]+–£[\d.,k]+, likely £[\d.,k]+ from about \d+ orders/);
    expect(brief).toMatch(/Draft rota £[\d,.k]+ = [\d.]+% of forecast sales · target 28%/);
    expect(brief).toMatch(/📅 \*This week\*/);
    expect(brief).toMatch(/Sat: West Ham v Fulham \(home\), expect busier \(\+\d+%\)/);
    expect(brief).toMatch(/Wed: Test bank holiday/);
    expect(brief).toMatch(/we don't have Tower Hamlets' term dates yet/);
    expect(brief).toMatch(/💷 \*This week\*[\s\S]*📅 \*This week\*/); // finance first, then the calendar
    expect(brief).not.toMatch(/Upload last year's sales/);
    // The idea for Saturday's match (5 days ahead), with the Draft an offer / Not now buttons, saved once.
    const idea = t.sent.find((m) => (m.buttons as { buttons?: string })?.buttons === "offer");
    show("Campaign idea", idea?.text ?? "(none)");
    expect(idea?.text).toMatch(/West Ham v Fulham \(home\) on Saturday should be busier/);
    expect(t.db.tables.calendar_suggestions).toHaveLength(1);
    expect(t.db.tables.forecast_backtests).toHaveLength(1);
    expect(Number(t.db.tables.forecast_backtests[0].error_pct)).toBeLessThan(20);
    expect(t.sent.filter((m) => m.text.startsWith("BUILDER"))).toEqual([]); // no section failed
  }, 120_000);

  test("the Monday report: Last week, Google, Next week and 3 actions; under 25 lines on WhatsApp", async () => {
    const now = new Date(`${monday}T09:10:00Z`);
    vi.useFakeTimers({ toFake: ["Date"] }); // scheduled jobs read the real clock: make it that Monday
    vi.setSystemTime(now);
    const t = await load();
    const ctx = await t.loadRestaurantContext(TK, { realTime: true });
    const report = await t.createReport(ctx, t.reportPeriod(now, true));
    show("Monday report on WhatsApp", report.headline);
    const keys = report.data.sections.map((s) => (s.id === "feature" ? s.key : s.id));
    expect(keys.slice(0, 4)).toEqual(["headline", "last_week", "google_week", "next_week"]);
    expect(keys).not.toContain("reputation"); // replaced by the Google section
    expect(keys.at(-1)).toBe("actions");
    const section = (k: string) => report.data.sections.find((s) => s.id === "feature" && s.key === k) as { lines: string[]; stats: { label: string }[] };
    const last = section("last_week").lines.join("\n");
    expect(last).toMatch(/forecast \(£[\d.,k]+, range £[\d.,k]+–£[\d.,k]+\); \d of 7 days inside their range/);
    expect(last).toMatch(/Labour £[\d.,k]+ from the rota = [\d.]+% of sales · target 28%/);
    expect(last).toMatch(/Best day: \w+day £[\d.,k]+ · worst: \w+day £[\d.,k]+/);
    const g = section("google_week");
    expect(g.stats.map((s) => s.label)).toEqual(["Google rating", "New reviews", "Replies sent"]);
    expect(g.lines.join("\n")).toMatch(/Calls \d+ \(was \d+\) · direction requests \d+ \(was \d+\) · profile views [\d,]+ \(was [\d,]+\) \(dummy\)/);
    expect(g.lines.join("\n")).toMatch(/Themes: /);
    const next = section("next_week").lines.join("\n");
    expect(next).toMatch(/Sales forecast £[\d.,k]+–£[\d.,k]+/);
    expect(next).toMatch(/Draft rota £[\d.,k]+ = [\d.]+% of forecast sales · target 28%/);
    expect(next).toMatch(/Sat: West Ham v Fulham \(home\), expect busier/);
    const actions = report.data.sections.find((s) => s.id === "actions");
    expect(actions && "actions" in actions ? actions.actions : []).toHaveLength(3);
    const lines = report.headline.split("\n");
    expect(lines.length).toBeLessThanOrEqual(25);
    expect(lines.at(-1)).toMatch(/^Full report: https:\/\/app\.test\/report\//);
    expect(report.headline).toMatch(/\*Last week\*/);
    expect(report.headline).toMatch(/\*Google\*/);
    expect(report.headline).toMatch(/\*Next week\*/);
    expect(report.headline).toMatch(/\*3 things to do\*\n1\. .+\n2\. .+\n3\. .+/);
    vi.useRealTimers();
  }, 120_000);
});
