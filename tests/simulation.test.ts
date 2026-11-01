// The Pilot Zero simulation (lib/simulation-rules.ts, lib/simulation.ts): only a
// marked restaurant can be simulated, its clock follows the simulated date, real
// scheduled jobs skip it, Run day runs every job for the date in the real order
// (each at its own time, one queued job per step), everything injected is
// labelled and can be cleared, and nothing touches another restaurant.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeAfter } from "./support/after";
import { memoryDb } from "./support/memory-db";
import {
  QUIET_SHARE,
  runDaySteps,
  simulatedLabel,
  simulatedReview,
  simulatedZ,
  simulationOn,
  usualTakings,
} from "@/lib/simulation-rules";

const MON = ["release", "birthday", "post", "report", "monday", "brief"];
const THU = ["release", "post", "brief"];

describe("the rules", () => {
  test("on only for a Pilot Zero restaurant with a simulated clock", () => {
    expect(simulationOn({ pilot_zero: true, fake_now: "2026-11-04T12:00:00Z" })).toBe(true);
    expect(simulationOn({ pilot_zero: true, fake_now: null })).toBe(false);
    expect(simulationOn({ pilot_zero: false, fake_now: "2026-11-04T12:00:00Z" })).toBe(false);
    expect(simulationOn({ fake_now: "2026-11-04T12:00:00Z" })).toBe(false);
    expect(simulationOn(null)).toBe(false);
  });

  test("Run day follows the real day: review check, forecast, the morning job in its order, Thursday's rota at 10", () => {
    const mon = runDaySteps(1, 9, MON);
    expect(mon.map((s) => s.morning ?? s.step)).toEqual(["reviews", "forecast", ...MON]);
    expect(mon.map((s) => `${s.hour}:${s.minute}`).slice(0, 3)).toEqual(["2:5", "5:35", "9:0"]);
    expect(mon.find((s) => s.morning === "report")?.label).toBe("Monday report");
    expect(runDaySteps(4, 9, THU).map((s) => s.morning ?? s.step)).toEqual(["reviews", "forecast", "release", "post", "brief", "rota"]);
    // An 11am brief: the 10am rota comes first, as it would for real.
    expect(runDaySteps(4, 11, THU).map((s) => s.morning ?? s.step)).toEqual(["reviews", "forecast", "rota", "release", "post", "brief"]);
    expect(runDaySteps(2, 9, ["release", "brief"]).some((s) => s.step === "rota")).toBe(false);
  });

  test("till reports: the usual takings for that weekday, a quiet day at 45%", () => {
    const weekdayOf = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const history = [
      { day: "2026-10-23", net_sales: 1800 }, // Fridays
      { day: "2026-10-30", net_sales: 2000 },
      { day: "2026-10-29", net_sales: 1100 }, // a Thursday
    ];
    expect(usualTakings(history, 5, weekdayOf)).toBe(1900);
    expect(usualTakings([], 5, weekdayOf)).toBe(1700); // a typical Friday with no history
    const z = simulatedZ({ net: 1900, quiet: false });
    expect(z).toMatchObject({ net_sales: 1900, gross_sales: 2280, vat: 380, transactions: 95 });
    expect(z.hourly.reduce((s, h) => s + h.sales, 0)).toBeCloseTo(2280, 0);
    expect(simulatedZ({ net: 1900, quiet: true }).net_sales).toBeCloseTo(1900 * QUIET_SHARE, 2);
  });

  test("reviews are labelled 'Sim:', cycle through the canned ones, and a 1-star one is a real complaint", () => {
    expect(simulatedReview(1)).toMatchObject({ rating: 1, author: expect.stringMatching(/^Sim: /), text: expect.stringMatching(/cold/) });
    expect(simulatedReview(5, 0).author).not.toBe(simulatedReview(5, 1).author);
    expect(simulatedReview(9).rating).toBe(5);
    for (const r of [1, 2, 3, 4, 5]) expect(simulatedReview(r).text).not.toMatch(/[—–]/);
    expect(simulatedLabel("Tuesday 4 November")).toBe("🧪 Simulated day: Tuesday 4 November. Figures and reviews here may be simulated.");
  });
});

// ---------- Against the stand-in database ----------

const PZ = "aaaaaaaa-0000-0000-0000-000000000001"; // the Pilot Zero restaurant
const OTHER = "aaaaaaaa-0000-0000-0000-000000000002"; // a real restaurant
const OLD_DB = "aaaaaaaa-0000-0000-0000-000000000003"; // before 056

let db: ReturnType<typeof memoryDb>;
const queued: { type: string; restaurantId: string | null; key: string; payload?: Record<string, unknown> }[] = [];

const base = { active: true, is_demo: false, pilot_zero: false, fake_now: null, owner_whatsapp: "whatsapp:+447463775130", whatsapp_from: "whatsapp:+14155238886", brief_hour: 9 };

beforeEach(() => {
  vi.resetModules();
  queued.length = 0;
  db = memoryDb({
    restaurants: [
      { ...base, id: PZ, name: "Pilot Zero Hall", pilot_zero: true },
      { ...base, id: OTHER, name: "A real restaurant", owner_whatsapp: "whatsapp:+447700900555" },
      { id: OLD_DB, name: "Before 056", active: true },
    ],
    sales_days: [
      { id: "s1", restaurant_id: PZ, day: "2026-10-30", net_sales: 2000, simulated: false, is_dummy: false, source: "pos" },
      { id: "s2", restaurant_id: PZ, day: "2026-10-23", net_sales: 1800, simulated: false, is_dummy: false, source: "pos" },
      { id: "s3", restaurant_id: PZ, day: "2026-11-05", net_sales: 900, simulated: false, is_dummy: false, source: "z_report" }, // a real Thursday
      { id: "s9", restaurant_id: OTHER, day: "2026-11-06", net_sales: 1, simulated: true, is_dummy: true, source: "z_report" },
    ],
    sales_hours: [],
    reviews: [{ id: "rv9", restaurant_id: OTHER, source: "simulated", simulated: true, rating: 5, author_name: "Sim: x", handled_at: null }],
    audit_log: [],
    jobs: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/queue/store", () => ({
    enqueue: async (j: { type: string; restaurantId: string | null; key: string; payload?: Record<string, unknown> }) => (queued.push(j), { id: j.key }),
    workersWanted: async () => 0,
  }));
  vi.doMock("@/lib/queue/kick", () => ({ kickWorkers: async () => 0 }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
});

afterEach(() => {
  vi.useRealTimers();
  for (const m of ["@/lib/supabase", "@/lib/queue/store", "@/lib/queue/kick", "next/server", "@/lib/morning", "@/lib/google-jobs", "@/lib/forecast/snapshot", "@/lib/rota/build", "@/lib/notify", "@/lib/assistant"]) vi.doUnmock(m);
});

const row = (id: string) => db.tables.restaurants.find((r) => r.id === id)!;
const sim = () => import("@/lib/simulation");

describe("starting, moving and stopping", () => {
  test("only a marked restaurant can be simulated; the clock rests at midday London time; it's logged", async () => {
    const { setSimulatedDay, nextSimulatedDay, SimulationError } = await sim();
    await expect(setSimulatedDay(OTHER, "2026-11-06", "me@b.dev")).rejects.toThrow(/isn't marked for Pilot Zero/);
    await expect(setSimulatedDay(OLD_DB, "2026-11-06", "me@b.dev")).rejects.toThrow(/056_pilot_zero/);
    await expect(setSimulatedDay(PZ, "6 Nov", "me@b.dev")).rejects.toBeInstanceOf(SimulationError);
    await setSimulatedDay(PZ, "2026-11-06", "me@b.dev");
    expect(row(PZ).fake_now).toBe("2026-11-06T12:00:00.000Z"); // GMT in November
    expect(row(OTHER).fake_now).toBeNull();
    await nextSimulatedDay(PZ, "me@b.dev");
    expect(row(PZ).fake_now).toBe("2026-11-07T12:00:00.000Z");
    expect(db.tables.audit_log.map((a) => a.detail)).toEqual([
      expect.stringMatching(/^Simulation started on 2026-11-06: real scheduled jobs skip this restaurant \(by me@b\.dev\)/),
      expect.stringMatching(/moved from 2026-11-06 to 2026-11-07/),
    ]);
    expect(db.tables.audit_log.every((a) => a.actor === "builder" && a.action === "simulation")).toBe(true);
  });

  test("the restaurant's clock is the simulated one (not for a real restaurant with a stray fake_now)", async () => {
    const { restaurantNow } = await import("@/lib/supabase");
    expect(restaurantNow({ ...base, pilot_zero: true, fake_now: "2026-11-06T12:00:00Z" } as never).toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(Math.abs(restaurantNow({ ...base, fake_now: "2020-01-01T00:00:00Z" } as never).getTime() - Date.now())).toBeLessThan(5000);
  });

  test("stopping goes back to real time and leaves waiting simulated reviews handled, so the real check never drafts them", async () => {
    const { setSimulatedDay, injectReview, stopSimulation } = await sim();
    await setSimulatedDay(PZ, "2026-11-06", "me@b.dev");
    await injectReview(PZ, 1, "me@b.dev");
    await stopSimulation(PZ, "me@b.dev");
    expect(row(PZ).fake_now).toBeNull();
    expect(db.tables.reviews.find((r) => r.restaurant_id === PZ)!.handled_at).toEqual(expect.any(String));
    expect(db.tables.reviews.find((r) => r.id === "rv9")!.handled_at).toBeNull(); // another restaurant's: untouched
  });
});

describe("injecting", () => {
  test("a till report: the usual Friday, stored as dummy and simulated, with hours; a quiet day replaces it", async () => {
    const { setSimulatedDay, injectZReport } = await sim();
    await expect(injectZReport(PZ, { quiet: false }, "me@b.dev")).rejects.toThrow(/Start the simulation/);
    await setSimulatedDay(PZ, "2026-11-06", "me@b.dev"); // a Friday
    expect(await injectZReport(PZ, { quiet: false }, "me@b.dev")).toEqual({ day: "2026-11-06", net: 1900, quiet: false });
    const day = () => db.tables.sales_days.filter((d) => d.restaurant_id === PZ && d.day === "2026-11-06");
    expect(day()).toEqual([expect.objectContaining({ net_sales: 1900, source: "z_report", is_dummy: true, simulated: true })]);
    expect(db.tables.sales_hours.filter((h) => h.restaurant_id === PZ)).toHaveLength(10);
    await injectZReport(PZ, { quiet: true }, "me@b.dev");
    expect(day()).toEqual([expect.objectContaining({ net_sales: 855, simulated: true })]);
    expect(db.tables.sales_hours.filter((h) => h.restaurant_id === PZ)).toHaveLength(10);
    expect(await injectZReport(PZ, { quiet: false, net: 1234.5 }, "me@b.dev")).toMatchObject({ net: 1234.5 });
  });

  test("never replaces a day that has real figures", async () => {
    const { setSimulatedDay, injectZReport } = await sim();
    await setSimulatedDay(PZ, "2026-11-05", "me@b.dev");
    await expect(injectZReport(PZ, { quiet: false }, "me@b.dev")).rejects.toThrow(/already has real sales figures/);
    expect(db.tables.sales_days.find((d) => d.id === "s3")).toMatchObject({ net_sales: 900, simulated: false });
  });

  test("a review arrives at the simulated time, labelled, as a simulated review (never replied to on Google)", async () => {
    const { setSimulatedDay, injectReview } = await sim();
    await setSimulatedDay(PZ, "2026-11-06", "me@b.dev");
    await injectReview(PZ, 1, "me@b.dev");
    expect(db.tables.reviews.find((r) => r.restaurant_id === PZ)).toMatchObject({
      source: "simulated",
      simulated: true,
      rating: 1,
      author_name: expect.stringMatching(/^Sim: /),
      review_date: "2026-11-06T12:00:00.000Z",
      replied: false,
    });
  });

  test("clearing removes only this restaurant's simulated rows", async () => {
    const { setSimulatedDay, injectZReport, injectReview, clearSimulatedData } = await sim();
    await setSimulatedDay(PZ, "2026-11-06", "me@b.dev");
    await injectZReport(PZ, { quiet: false }, "me@b.dev");
    await injectReview(PZ, 5, "me@b.dev");
    expect(await clearSimulatedData(PZ, "me@b.dev")).toEqual({ reviews: 1, sales_hours: 10, sales_days: 1 });
    expect(db.tables.sales_days.map((d) => d.id).sort()).toEqual(["s1", "s2", "s3", "s9"]);
    expect(db.tables.reviews.map((r) => r.id)).toEqual(["rv9"]);
    await expect(clearSimulatedData(OTHER, "me@b.dev")).rejects.toThrow(/isn't marked/);
  });
});

describe("Run day", () => {
  const ran: { what: string; at: string }[] = [];
  const mockJobs = (failRota = false) => {
    ran.length = 0;
    const clock = () => row(PZ).fake_now as string;
    vi.doMock("@/lib/morning", () => ({
      runMorningStep: async (_r: unknown, step: string, now: Date, carry: object) => {
        ran.push({ what: step, at: now.toISOString() });
        expect(clock()).toBe(now.toISOString()); // the restaurant's clock is set to the step's time
        return { done: step, carry: step === "release" ? { released: "1 send went out" } : carry, ...(step === "brief" ? { brief: { sent: true } } : {}) };
      },
    }));
    vi.doMock("@/lib/google-jobs", () => ({ runReviewCheck: async () => (ran.push({ what: "reviews", at: clock() }), { found: 1, held: 1 }) }));
    vi.doMock("@/lib/forecast/snapshot", () => ({ savedWeekAhead: async (_id: string, week: string, now: Date) => (ran.push({ what: `forecast ${week}`, at: now.toISOString() }), { weekStart: week }) }));
    vi.doMock("@/lib/rota/build", () => ({
      suggestRota: async (_r: unknown, o: { now: Date }) => {
        ran.push({ what: "rota", at: o.now.toISOString() });
        if (failRota) throw new Error("no team");
        return { drafted: true };
      },
    }));
    vi.doMock("@/lib/notify", () => ({ messageOwner: async () => {} }));
    vi.doMock("@/lib/assistant", () => ({ loadRestaurantContext: async (id: string) => ({ restaurant: row(id) }) }));
  };

  // Runs the queued steps one after another, as the workers would.
  async function drain() {
    const { runDayStep } = await sim();
    const results: unknown[] = [];
    for (let i = 0; i < 20 && queued.length; i++) {
      const job = queued.shift()!;
      expect(job.type).toBe("sim_day");
      results.push(await runDayStep(job.restaurantId!, job.payload as never));
    }
    return results.at(-1) as { finished?: boolean; failed?: number; results: { label: string; at: string; error?: string }[] };
  }

  test("a Thursday: every job for that date in the real order, each at its own time, then the clock rests at midday", async () => {
    mockJobs();
    const { setSimulatedDay, queueRunDay } = await sim();
    await setSimulatedDay(PZ, "2026-11-12", "me@b.dev"); // a Thursday
    await queueRunDay(PZ, "me@b.dev");
    const last = await drain();
    expect(ran).toEqual([
      { what: "reviews", at: "2026-11-12T02:05:00.000Z" },
      { what: "forecast 2026-11-09", at: "2026-11-12T05:35:00.000Z" },
      { what: "release", at: "2026-11-12T09:00:00.000Z" },
      { what: "post", at: "2026-11-12T09:00:00.000Z" },
      { what: "brief", at: "2026-11-12T09:00:00.000Z" },
      { what: "rota", at: "2026-11-12T10:00:00.000Z" },
    ]);
    expect(last).toMatchObject({ finished: true, failed: 0 });
    expect(last.results.map((r) => r.label)).toEqual(["Review check", "Nightly forecast", "Held sends released", "Google post", "Morning brief", "Thursday rota"]);
    expect(row(PZ).fake_now).toBe("2026-11-12T12:00:00.000Z");
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "simulation", detail: expect.stringMatching(/^Run day for 2026-11-12 .*Thursday rota done/) });
  });

  test("a Monday runs the birthday email, report and Monday planning before the brief; a failed step is recorded and the rest still run", async () => {
    mockJobs(true);
    const { setSimulatedDay, queueRunDay } = await sim();
    await setSimulatedDay(PZ, "2026-11-09", "me@b.dev");
    await queueRunDay(PZ, "me@b.dev");
    const last = await drain();
    expect(ran.map((x) => x.what)).toEqual(["reviews", "forecast 2026-11-09", ...MON]);
    expect(last.failed).toBe(0);

    // Thursday with a rota that fails: recorded, and the day still finishes.
    mockJobs(true);
    await setSimulatedDay(PZ, "2026-11-12", "me@b.dev");
    await queueRunDay(PZ, "me@b.dev");
    const thu = await drain();
    expect(thu).toMatchObject({ finished: true, failed: 1 });
    expect(thu.results.at(-1)).toMatchObject({ label: "Thursday rota", error: "no team" });
  });

  test("a queued step does nothing once the simulation has moved on or stopped", async () => {
    mockJobs();
    const { setSimulatedDay, queueRunDay, stopSimulation, runDayStep } = await sim();
    await setSimulatedDay(PZ, "2026-11-12", "me@b.dev");
    await queueRunDay(PZ, "me@b.dev");
    await stopSimulation(PZ, "me@b.dev");
    const job = queued.shift()!;
    expect(await runDayStep(PZ, job.payload as never)).toMatchObject({ skipped: expect.stringMatching(/isn't on 2026-11-12/) });
    expect(ran).toEqual([]);
    expect(row(PZ).fake_now).toBeNull();
  });
});

describe("real scheduled jobs skip a simulating restaurant", () => {
  test("the dispatcher queues nothing for it, and its brief isn't reported late", async () => {
    vi.doMock("@/lib/feeds/status", () => ({ enabledFeeds: async () => [] }));
    vi.doMock("@/lib/feeds/backfill", () => ({ enqueueBackfill: async () => null }));
    Object.assign(row(PZ), { fake_now: "2026-11-12T12:00:00Z" });
    Object.assign(row(OTHER), { last_brief_on: null });
    const now = new Date("2026-11-03T10:10:00Z"); // a Tuesday, after the brief hour
    const { dispatch } = await import("@/lib/queue/dispatch");
    await dispatch("hourly", now);
    const forRestaurant = (id: string) => queued.filter((j) => j.restaurantId === id).map((j) => j.type);
    expect(forRestaurant(PZ)).toEqual([]);
    expect(forRestaurant(OTHER)).toEqual(expect.arrayContaining(["review_check", "morning"]));

    const alerts: string[] = [];
    vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "sent") }));
    Object.assign(row(PZ), { last_brief_on: null });
    const { checkLateBriefs } = await import("@/lib/queue/health");
    const late = await checkLateBriefs(now);
    expect(late).toContain(OTHER);
    expect(late).not.toContain(PZ);
    vi.doUnmock("@/lib/feeds/status");
    vi.doUnmock("@/lib/feeds/backfill");
    vi.doUnmock("@/lib/builder-alerts");
  });
});
