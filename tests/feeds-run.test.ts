// One full run of every outside data feed on a test restaurant: the real feed
// code against the in-memory database (tests/support/memory-db.ts, with the
// feeds' database functions in support/feeds-memory.ts) and the saved real
// answers instead of the network. Then: every factor the forecast model reads
// has data for the next 14 days; re-running adds nothing twice; forecasts as
// issued are never changed; uncertain dates and their confirmation; a missing
// API key is a clean skip; and the backfill is queued on the right triggers.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { STEPS } from "@/lib/onboarding/steps";
import { memoryDb } from "./support/memory-db";
import type { QueueJob } from "@/lib/queue/store";

const R = "f0f0f0f0-0000-0000-0000-000000000001";
const fx = (name: string) => readFileSync(new URL(`./fixtures/feeds/${name}`, import.meta.url), "utf8");
const terms = JSON.parse(readFileSync(new URL("../src/lib/feeds/data/school_terms.json", import.meta.url), "utf8")).councils.E09000026.terms as { start: string; end: string; half_term: string[] }[];

let db: ReturnType<typeof memoryDb>;
const calls: string[] = [];

function answer(url: string): Response {
  const u = new URL(url);
  calls.push(`${u.hostname}${u.pathname}`);
  const json = (name: string) => new Response(fx(name), { status: 200, headers: { "content-type": "application/json" } });
  if (u.hostname === "api.open-meteo.com" && u.pathname.includes("meta.json")) return json("openmeteo_meta.json");
  if (u.hostname === "api.open-meteo.com") return json("openmeteo_forecast.json");
  if (u.hostname === "archive-api.open-meteo.com") return json("openmeteo_archive.json");
  if (u.hostname === "previous-runs-api.open-meteo.com") return json("openmeteo_previous.json");
  if (u.hostname === "www.gov.uk") return json("govuk_bank_holidays.json");
  if (u.hostname === "api.football-data.org") {
    if (u.pathname.includes("/PL/")) return json("football-data_PL_matches.json");
    if (u.pathname.includes("/CL/")) return json("football-data_CL_matches.json");
    return new Response(JSON.stringify({ matches: [] }), { status: 200 });
  }
  if (u.hostname === "app.ticketmaster.com") return json("ticketmaster_events.json");
  if (u.hostname === "api.tfl.gov.uk" && u.pathname.startsWith("/Line/Mode")) return json("tfl_lines.json");
  if (u.hostname === "api.tfl.gov.uk" && u.pathname.startsWith("/Line/")) return json("tfl_status_range.json");
  if (u.hostname === "api.tfl.gov.uk") return json("tfl_stoppoints.json");
  if (u.hostname === "api.postcodes.io") return json("postcodes_e1.json");
  if (u.hostname === "www.football-data.co.uk") return new Response(fx("fdcouk_E0_2526_head.csv"), { status: 200 });
  return new Response("not found", { status: 404 });
}

const job = (type: string, payload: Record<string, unknown> = {}, restaurantId: string | null = null): QueueJob =>
  ({ id: `${type}-job`, type, restaurant_id: restaurantId, idempotency_key: type, payload, priority: 50, run_at: "", status: "running", attempts: 1, max_attempts: 3,
    concurrency_key: null, locked_by: null, locked_until: null, last_error: null, result: null, alerted_at: null, created_at: "", started_at: null, finished_at: null }) as QueueJob;

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T03:30:00Z") }); // 04:30 UK
  db = memoryDb({
    restaurants: [
      { id: R, name: "Saffron Test", active: true, is_demo: true, address: "1 Cranbrook Road, Ilford IG1 4DU", latitude: 51.559, longitude: 0.07, council_code: "E09000026",
        council_name: "Redbridge", nation: "england", weather_cell: null, prayer_method: null, religious_authority: "east-london-mosque", outside_backfilled_at: "2026-10-01T00:00:00Z",
        cuisine: "Halal grill", created_at: "2026-01-01T00:00:00Z" },
    ],
    feed_status: ["weather", "calendar", "prayer", "football", "events", "disruption", "school_terms", "backfill"].map((feed) => ({
      feed, enabled: true, fresh_hours: feed === "weather" ? 26 : feed === "backfill" ? null : 50, last_success_at: null, last_outcome: null,
    })),
    councils: [{ code: "E09000026", name: "Redbridge", dates_known_until: "2026-12-18" }],
    school_dates: terms.map((t, i) => ({ id: `t${i}`, council_code: "E09000026", kind: "term", start_day: t.start, end_day: t.end, half_term_start: t.half_term[0], half_term_end: t.half_term[1] })),
    restaurant_teams: [{ id: "tm1", restaurant_id: R, team: "West Ham" }],
    venues: [],
    local_calendar: [],
    calendar_relevance: [],
    cached_data: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/feeds/wait", () => ({ wait: async () => {} }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: vi.fn(async () => "ok") }));
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => answer(String(url))));
  vi.stubEnv("FOOTBALL_DATA_API_KEY", "test-football-key");
  vi.stubEnv("TICKETMASTER_API_KEY", "test-tm-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/feeds/wait");
  vi.doUnmock("@/lib/builder-alerts");
  vi.restoreAllMocks();
});

async function runAll() {
  const { FEED_JOB_HANDLERS } = await import("@/lib/feeds/jobs");
  const day = "2026-10-19";
  const out: Record<string, unknown> = {};
  out.calendar = await FEED_JOB_HANDLERS.feed_calendar.run(job("feed_calendar", { day }));
  out.weather = await FEED_JOB_HANDLERS.feed_weather.run(job("feed_weather", { mode: "daily", cell: `restaurant:${R}`, restaurants: [R], day }, R));
  out.prayer = await FEED_JOB_HANDLERS.feed_prayer.run(job("feed_prayer", { day }, R));
  out.football = await FEED_JOB_HANDLERS.feed_football.run(job("feed_football", { day }));
  out.events = await FEED_JOB_HANDLERS.feed_events.run(job("feed_events", { day }, R));
  out.disruption = await FEED_JOB_HANDLERS.feed_disruption.run(job("feed_disruption", { day }));
  out.terms = await FEED_JOB_HANDLERS.feed_terms_check.run(job("feed_terms_check", { day }));
  return out;
}

describe("one full feed run on a test restaurant", () => {
  test("every factor the forecast model reads has data for the next 14 days", async () => {
    const out = await runAll();
    for (const [feed, result] of Object.entries(out)) expect(result, feed).toHaveProperty("rows");
    const { coverageFor } = await import("@/lib/feeds/coverage-data");
    const { rows } = await coverageFor(R, new Date(), 14);
    expect(rows.filter((r) => r.status === "missing").map((r) => `${r.group}: ${r.note}`)).toEqual([]);
    // The restaurant now has its weather cell and prayer method, and the venues are seeded.
    expect(db.tables.restaurants[0]).toMatchObject({ weather_cell: "51.50,0.00", prayer_method: "computed:moonsighting_committee+hanafi" });
    expect(db.tables.venues.map((v) => v.name)).toEqual(expect.arrayContaining(["London Stadium", "ExCeL London", "The O2", "Wembley Stadium", "Tottenham Hotspur Stadium"]));
    // Every row says where it came from and when it was fetched; feed rows carry their external id.
    expect(db.tables.local_calendar.every((c) => c.source && c.fetched_at && c.external_source && c.external_id)).toBe(true);
    expect(db.tables.weather_hours.every((h) => h.source === "feed" && h.fetched_at && h.sunshine_min !== undefined)).toBe(true);
    expect(db.tables.prayer_times.every((p) => p.source === "feed" && p.fetched_at)).toBe(true);
    // West Ham v Arsenal at London Stadium carries its crowd; the O2 event got the O2's Ticketmaster id.
    expect(db.tables.football_fixtures.find((f) => f.home_team === "West Ham")).toMatchObject({ sport: "football", competition: "Premier League" });
    expect(db.tables.venues.find((v) => v.name === "The O2")?.ticketmaster_id).toBe("KovZ9177Arf");
    // Keys never land in the cache or the database.
    expect(JSON.stringify(db.tables)).not.toMatch(/test-football-key|test-tm-key/);
  }, 60_000);

  test("re-running a feed never adds a row twice", async () => {
    await runAll();
    const before = Object.fromEntries(["local_calendar", "football_fixtures", "weather_hours", "weather_days", "weather_forecasts", "prayer_times", "calendar_relevance", "venues"].map((t) => [t, db.tables[t]?.length ?? 0]));
    await runAll();
    const after = Object.fromEntries(Object.keys(before).map((t) => [t, db.tables[t]?.length ?? 0]));
    expect(after).toEqual(before);
  }, 60_000);

  test("forecasts as issued are never changed: a later issue adds rows, the earlier ones stay as they were", async () => {
    await runAll();
    const first = structuredClone(db.tables.weather_forecasts);
    vi.setSystemTime(new Date("2026-10-19T05:45:00Z")); // the 06:45 refresh
    const { FEED_JOB_HANDLERS } = await import("@/lib/feeds/jobs");
    await FEED_JOB_HANDLERS.feed_weather.run(job("feed_weather", { mode: "refresh", cell: "51.50,0.00", restaurants: [R], day: "2026-10-19" }));
    expect(db.tables.weather_forecasts.length).toBeGreaterThan(first.length);
    for (const f of first) expect(db.tables.weather_forecasts).toContainEqual(f);
    expect(new Set(db.tables.weather_forecasts.map((f) => f.issued_at))).toEqual(new Set(["2026-10-19T03:30:00.000Z", "2026-10-19T05:45:00.000Z"]));
  }, 60_000);

  test("a feed whose API key is missing is skipped and reported, never a crash", async () => {
    vi.stubEnv("FOOTBALL_DATA_API_KEY", "");
    vi.stubEnv("TICKETMASTER_API_KEY", "");
    const { FEED_JOB_HANDLERS } = await import("@/lib/feeds/jobs");
    expect(await FEED_JOB_HANDLERS.feed_football.run(job("feed_football"))).toEqual({ skipped: "no FOOTBALL_DATA_API_KEY set" });
    expect(await FEED_JOB_HANDLERS.feed_events.run(job("feed_events", {}, R))).toEqual({ skipped: "no TICKETMASTER_API_KEY set" });
    expect(calls.some((c) => c.includes("football-data.org") || c.includes("ticketmaster"))).toBe(false);
    expect(db.tables.feed_status.find((s) => s.feed === "football")).toMatchObject({ last_outcome: "skipped", last_detail: { skipped: "no FOOTBALL_DATA_API_KEY set" } });
    // ...and the watchdog doesn't call that a problem.
    const { checkFeedHealth } = await import("@/lib/feeds/status");
    expect(await checkFeedHealth(new Date())).toEqual([]);
  });

  test("a failing feed is recorded, retried by the queue, and the watchdog tells the builder (not the owner)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const { FEED_JOB_HANDLERS } = await import("@/lib/feeds/jobs");
    await expect(FEED_JOB_HANDLERS.feed_disruption.run(job("feed_disruption"))).rejects.toThrow(/503/);
    expect(db.tables.feed_status.find((s) => s.feed === "disruption")).toMatchObject({ last_outcome: "failed" });
    const { checkFeedHealth } = await import("@/lib/feeds/status");
    const { alertBuilder } = await import("@/lib/builder-alerts");
    expect(await checkFeedHealth(new Date())).toEqual([expect.stringMatching(/disruption feed is failing/)]);
    expect(alertBuilder).toHaveBeenCalledWith("feed:disruption", expect.stringMatching(/No owner has been told/));
  });
});

describe("uncertain religious dates", () => {
  test("expected dates are uncertain; the builder's confirmation moves Eid, chand raat and the end of Ramadan, and a re-run keeps it", async () => {
    vi.setSystemTime(new Date("2027-03-05T10:00:00Z"));
    const { FEED_JOB_HANDLERS } = await import("@/lib/feeds/jobs");
    await FEED_JOB_HANDLERS.feed_calendar.run(job("feed_calendar"));
    const eid = () => db.tables.local_calendar.find((c) => c.external_id === "east-london-mosque:eid_fitr:1448")!;
    expect(eid()).toMatchObject({ day: "2027-03-09", date_uncertain: true, alt_day: "2027-03-10" });
    const { handleBuilderCommand } = await import("@/lib/feeds/builder");
    const reply = await handleBuilderCommand("BUILDER Eid confirmed for Wednesday");
    expect(reply).toMatch(/Eid al-Fitr \(East London Mosque\) confirmed for 2027-03-10/);
    expect(eid()).toMatchObject({ day: "2027-03-10", date_uncertain: false, alt_day: null, confirmed_by: "builder (WhatsApp)" });
    expect(db.tables.local_calendar.find((c) => c.external_id === "east-london-mosque:chand_raat:1448")).toMatchObject({ day: "2027-03-09", date_uncertain: false });
    expect(db.tables.local_calendar.find((c) => c.external_id === "east-london-mosque:ramadan:1448")).toMatchObject({ end_day: "2027-03-09" });
    // UK moon sighting's Eid is a separate row, still uncertain.
    expect(db.tables.local_calendar.find((c) => c.external_id === "uk-moonsighting:eid_fitr:1448")).toMatchObject({ date_uncertain: true });
    await FEED_JOB_HANDLERS.feed_calendar.run(job("feed_calendar"));
    expect(eid()).toMatchObject({ day: "2027-03-10", date_uncertain: false });
    // Both are in the audit log as the builder.
    expect(db.tables.audit_log.map((l) => `${l.actor}:${l.action}`)).toEqual(expect.arrayContaining(["builder:outside_data", "builder:builder_command"]));
  });
});

describe("the backfill is queued on the right triggers", () => {
  const spy = vi.fn(async () => ({ id: "j" }));
  beforeEach(() => {
    spy.mockClear();
    vi.doMock("@/lib/feeds/backfill", async (orig) => ({ ...(await orig<object>()), enqueueBackfill: spy }));
  });
  afterEach(() => vi.doUnmock("@/lib/feeds/backfill"));

  test("a new address: the location is cleared and the backfill queued", async () => {
    const { updateRestaurantColumns } = await import("@/lib/ops/menu");
    await updateRestaurantColumns(R, { address: "2 High Road, London E15 1AA" });
    expect(spy).toHaveBeenCalledWith(R, "location");
    expect(db.tables.restaurants[0]).toMatchObject({ latitude: null, longitude: null, weather_cell: null, council_code: null });
    await updateRestaurantColumns(R, { phone: "020 7946 0000" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("a restaurant finishing onboarding", async () => {
    db.tables.restaurants[0].owner_whatsapp = "whatsapp:+447700900111";
    db.tables.onboarding = [{ id: "o1", restaurant_id: R, steps: Object.fromEntries(STEPS.filter((s) => s !== "finish").map((s) => [s, { status: "done", at: "2026-10-19T00:00:00Z" }])), data: {} }];
    const { finish } = await import("@/lib/onboarding/engine");
    expect((await finish(R)).ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(R, "created");
  });

  test("a POS import with older sales (not a recent one)", async () => {
    vi.doMock("@/lib/sales/ai", () => ({ readZReport: vi.fn(), suggestMapping: vi.fn(async () => ({ mapping: MAPPING, posName: "TillPoint", problem: null })) }));
    vi.doMock("@/lib/notify", () => ({ messageOwner: async () => {} }));
    const { receivePosFile, confirmImport } = await import("@/lib/sales/pos-import");
    const CSV = readFileSync("public/samples/pos-export-sample.csv");
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z")); // the sample's sales are this month: not history
    const first = await receivePosFile({ restaurantId: R, bytes: CSV, contentType: "text/csv", fileName: "export.csv", channel: "web", sentBy: null, actor: "owner" });
    await confirmImport(R, first.importId!, MAPPING);
    expect(spy).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2027-01-20T12:00:00Z")); // months later, the same sales are history
    db.tables.sales_items = [];
    db.tables.pos_layouts = [];
    const again = await receivePosFile({ restaurantId: R, bytes: CSV, contentType: "text/csv", fileName: "export.csv", channel: "web", sentBy: null, actor: "owner" });
    await confirmImport(R, again.importId!, MAPPING);
    expect(spy).toHaveBeenCalledWith(R, "pos_import");
    vi.doUnmock("@/lib/sales/ai");
    vi.doUnmock("@/lib/notify");
  });

  test("a restaurant from before the feeds (never backfilled) is queued by the hourly run", async () => {
    db.tables.restaurants[0].outside_backfilled_at = null;
    vi.doMock("@/lib/queue/store", async (orig) => ({ ...(await orig<object>()), enqueue: vi.fn(async () => null), workersWanted: async () => 0 }));
    vi.doMock("@/lib/queue/kick", () => ({ kickWorkers: async () => 0 }));
    const { dispatch } = await import("@/lib/queue/dispatch");
    await dispatch("hourly", new Date("2026-10-19T03:05:00Z"));
    expect(spy).toHaveBeenCalledWith(R, "first_run", expect.any(Date));
    vi.doUnmock("@/lib/queue/store");
    vi.doUnmock("@/lib/queue/kick");
  });
});

const MAPPING = { date: "Date", time: "Time", item: "Item", quantity: "Qty", price: "Line Total", price_is: "line_total" as const, receipt: "Receipt No", date_order: "dmy" as const };
