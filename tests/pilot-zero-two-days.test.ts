// Pilot Zero's "done when": a dummy restaurant simulated for two days with dry-run
// Google. A restaurant on the builder's number, set up as on live (Production,
// Google connected through our manager account, dry run by default), with the
// pilot-zero/ year of sales and team, runs two simulated days through the real
// simulation, morning job, review check, rota, send gate and Google wall. Only
// Claude, WhatsApp and Google's servers are stand-ins. Then Stop puts it all back.
// SHOW_OUTPUT=1 prints what the owner would have seen on WhatsApp.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { fakeAfter } from "./support/after";
import { memoryDb } from "./support/memory-db";
import type { PosMapping } from "@/lib/sales/pos-table";

const PZ = "aaaaaaaa-0000-0000-0000-0000000000f7";
const BUILDER = "whatsapp:+447463775130";
const CONN = "cccccccc-0000-0000-0000-0000000000f7";

let db: ReturnType<typeof memoryDb>;
const sent: string[] = [];
const alerts: string[] = [];
const googleWrites: string[] = [];
const enqueued: { type: string; restaurantId: string | null; payload?: Record<string, unknown> }[] = [];

const show = (title: string, lines: string[]) => {
  if (process.env.SHOW_OUTPUT) console.log(`\n===== ${title} =====\n${lines.join("\n----\n")}\n`);
};

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("GOOGLE_MODE", "live");
  vi.stubEnv("BUILDER_WHATSAPP", BUILDER);
  vi.stubEnv("TEST_MODE", "");
  vi.stubEnv("GOOGLE_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  const { encryptToken } = await import("@/lib/google/crypto");
  db = memoryDb(
    {
      restaurants: [
        {
          id: PZ, name: "Pilot Zero Food Hall", slug: "pilot-zero-food-hall", cuisine: "Halal food hall", active: true, is_demo: false, is_test: false,
          owner_whatsapp: BUILDER, whatsapp_from: "whatsapp:+14155238886", owner_email: "me+pilot0@builder.dev", brief_hour: 9,
          send_window_start: "09:00:00", send_window_end: "21:00:00", discount_cap_percent: 20, paused: false, fake_now: null, trust_levels: {},
          opening_hours: { Monday: "12:00 – 23:00", Tuesday: "12:00 – 23:00", Wednesday: "12:00 – 23:00", Thursday: "12:00 – 23:00", Friday: "12:00 – 23:00", Saturday: "12:00 – 23:00", Sunday: "12:00 – 23:00" },
          menu: [], labour_target_pct: 28, last_brief_on: "2026-11-01", last_report_on: null, last_post_draft_on: null, last_birthday_campaign_on: null, morning_failures: 0,
          pilot_zero: true, google_dry_run: null, google_profile_writes: null, simulation: null,
          google_connection_id: CONN, google_account_id: "accounts/1", google_location_id: "locations/9", google_location_title: "Maison Noor", google_imported_at: "2026-10-20T00:00:00Z",
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
      google_connections: [{ id: CONN, restaurant_id: null, kind: "manager", google_email: "dina@dinerai.co.uk", status: "ok", refresh_token_enc: encryptToken("r"), access_token_enc: encryptToken("a"), access_expires_at: "2030-01-01T00:00:00Z" }],
      reviews: [], drafts: [], sent_log: [], audit_log: [], blocked_sends: [], google_writes: [], google_posts: [], messages: [],
      pos_imports: [], pos_layouts: [], sales_items: [], sales_hours: [], sales_days: [], forecast_snapshots: [], staff: [], rota_weeks: [], rota_shifts: [], rota_rules: [],
      jobs: [], customers: [], campaigns: [], reports: [],
    },
    { unique: ["google_writes.key"] },
  );
  // Google: the real profile has one review without a reply. Every write is recorded (there must be none).
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method !== "GET" && url.pathname !== "/token") googleWrites.push(`${method} ${url.pathname}`);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/reviews")) return json({ totalReviewCount: 1, reviews: [{ name: "accounts/1/locations/9/reviews/g1", reviewId: "g1", reviewer: { displayName: "Real Customer" }, starRating: "FIVE", comment: "Lovely kunafa", createTime: "2026-11-01T10:00:00Z" }] });
    if (url.pathname.endsWith("/localPosts")) return json({ localPosts: [] });
    return json({});
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: (async (_c: unknown, text: string) => void sent.push(text)) }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: (async (_k: string, m: string) => void alerts.push(m)) }));
  vi.doMock("@/lib/queue/store", () => ({ enqueue: (async (j: (typeof enqueued)[number]) => (enqueued.push(j), { id: "job" })), workersWanted: async () => 0 }));
  vi.doMock("@/lib/queue/kick", () => ({ kickWorkers: (async () => 0) }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
  // Claude's parts: canned words (the checks pass them as they are).
  vi.doMock("@/lib/assistant", async (orig) => ({
    ...(await orig<object>()),
    writeReviewReply: (async (_c: unknown, _l: unknown, r: { author_name: string; rating: number }) => {
      const first = r.author_name.replace(/^Sim: /, "").split(" ")[0];
      return r.rating <= 3 ? `We're so sorry, ${first}. Please get in touch so we can put it right.` : `Thank you, ${first}! See you again soon.`;
    }),
    writeGooglePost: (async () => ({ text: "Fresh kunafa every evening this week.", topic: "update" })),
    writeReportInsights: (async () => { throw new Error("no AI in tests"); }),
  }));
  vi.doMock("@/lib/checks", async (orig) => ({ ...(await orig<object>()), checkDraft: (async (_c: unknown, d: { content: string }) => ({ content: d.content, checks: {} })) }));
  vi.doMock("@/lib/agents/reputation", async (orig) => ({ ...(await orig<object>()), queueReputationShadow: (async () => {}), weeklyThemesFor: (async () => null) }));
  vi.doMock("@/lib/agents/visibility", async (orig) => ({ ...(await orig<object>()), queueVisibilityShadow: (async () => {}) }));
  vi.doMock("@/lib/agents/gm", async (orig) => ({ ...(await orig<object>()), queueGmBriefShadow: (async () => {}) }));
  vi.doMock("@/lib/agents/insights", async (orig) => ({ ...(await orig<object>()), queueInsightsShadow: (async () => {}), insightsMode: (async () => "off") }));
  vi.doMock("@/lib/feeds/location", () => ({ ensureLocated: (async () => null) }));
  vi.doMock("@/lib/feeds/backfill", () => ({ enqueueBackfill: async () => null }));
  vi.doMock("@/lib/sales/ai", () => ({ suggestMapping: (async () => ({ mapping: SUMMARY_MAPPING, posName: "Square", problem: null })) }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  // The year of sales (through the real importer) and the team (as Dina's team card saves it).
  const { receivePosFile, confirmImport } = await import("@/lib/sales/pos-import");
  const name = "square-sales-summary-12-months.csv";
  const first = await receivePosFile({ restaurantId: PZ, bytes: readFileSync(`pilot-zero/${name}`), contentType: "text/csv", fileName: name, channel: "web", sentBy: null, actor: "owner" });
  await confirmImport(PZ, first.importId!, SUMMARY_MAPPING);
  const { saveStaff } = await import("@/lib/rota/staff");
  const { availabilityOf } = await import("@/lib/onboarding/dina/ops-content");
  const sheet = readFileSync("pilot-zero/staff-sheet.csv", "utf8").trim().split("\r\n").slice(1).map((l) => l.slice(1, -1).split('","'));
  for (const [n, role, rate, , days, times, max] of sheet) {
    const a = availabilityOf({ days, times, max_hours: Number(max) });
    await saveStaff(PZ, { name: n, roles: [role === "Front of house" ? "front" : role.toLowerCase()], ratePence: Math.round(Number(rate.replace("£", "")) * 100), maxHours: a.maxHours, days: a.days, starts: a.starts, ends: a.ends }, { today: "2026-11-01", source: "owner_message", actor: "owner" });
  }
  db.tables.rota_rules.push({ restaurant_id: PZ, role: "kitchen", min_on_shift: 2 }, { restaurant_id: PZ, role: "front", min_on_shift: 2 });
}, 120_000);

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SUMMARY_MAPPING: PosMapping = { date: "Date", time: null, item: null, quantity: null, price: "Net Sales", price_is: "line_total", receipt: null, date_order: "mdy", amount_basis: "net" };
const r = () => db.tables.restaurants[0];

// The run sheet's first step each simulated day: any WhatsApp to the restaurant (the 24-hour window).
const ownerSaysHi = () => db.tables.messages.push({ id: `in${db.tables.messages.length}`, restaurant_id: PZ, direction: "inbound", from_number: BUILDER, body: "Morning", created_at: new Date().toISOString() });

async function runDay() {
  const sim = await import("@/lib/simulation");
  await sim.queueRunDay(PZ, "me@builder.dev");
  let last: { results?: { label: string; error?: string; done?: string }[]; finished?: boolean } = {};
  for (let i = 0; i < 20; i++) {
    const job = enqueued.shift();
    if (!job) break;
    if (job.type !== "sim_day") continue;
    last = (await sim.runDayStep(PZ, job.payload as never)) as typeof last;
  }
  return last;
}

describe("two simulated days, Google dry run", () => {
  test("day 1, a Thursday: an overnight 1-star alerts at once; the brief, the post and the rota come; replies are only 'would have posted'", async () => {
    const sim = await import("@/lib/simulation");
    await sim.setSimulatedDay(PZ, "2026-11-12", "me@builder.dev");
    ownerSaysHi();
    await sim.injectReview(PZ, 1, "me@builder.dev");
    sent.length = 0;
    const day = await runDay();
    show("Day 1 (Thu 12 Nov): WhatsApp", sent);
    expect(day.finished).toBe(true);
    expect(day.results?.map((x) => `${x.label}: ${x.error ? `FAILED ${x.error}` : "ok"}`)).toEqual([
      "Review check: ok",
      "Nightly forecast: ok",
      "Held sends released: ok",
      "Google post: ok",
      "Morning brief: ok",
      "Thursday rota: ok",
    ]);
    // The 1-star (simulated) alerted at once; the real 5-star from Google waited for the brief.
    expect(sent.some((t) => /Laura/.test(t))).toBe(true);
    expect(sent.some((t) => /🧪 Simulated day: Thursday, 12 November 2026./.test(t))).toBe(true);
    expect(r().last_brief_on).toBe("2026-11-12");
    expect(db.tables.rota_weeks.some((w) => w.week_start === "2026-11-16")).toBe(true);
    // A year of daily totals isn't sales by the hour: the rota says so (not "less than 8 weeks").
    expect(sent.some((t) => t.includes("your sales so far are daily totals"))).toBe(true);
    expect(sent.some((t) => t.includes("less than 8 weeks"))).toBe(false);

    // Approving both replies: neither reaches Google.
    const { attemptSend } = await import("@/lib/send");
    const replies = db.tables.drafts.filter((d) => d.kind === "review_reply");
    expect(replies).toHaveLength(2);
    const notes: string[] = [];
    for (const d of replies) {
      Object.assign(d, { status: "approved", approved_at: new Date().toISOString() });
      const out = await attemptSend(String(d.id), r() as never, new Date("2026-11-12T12:00:00Z"), "approve");
      notes.push(out.outcome === "sent" ? (out.note ?? "") : `${out.outcome}: ${"detail" in out ? out.detail : ""}`);
    }
    show("Day 1: what approving said", notes);
    expect(notes.find((n) => n.includes("Laura") || n.includes("so sorry"))).toMatch(/^🧪 Simulated review, so never replied to on Google\./);
    expect(notes.find((n) => n.includes("Real Customer") || n.includes("Thank you"))).toMatch(/^🧪 Dry run: nothing changed on Google\. Would have posted this reply on Google \(Maison Noor\)/);
    expect(googleWrites).toEqual([]);

    // The evening's till report.
    expect(await sim.injectZReport(PZ, { quiet: false }, "me@builder.dev")).toMatchObject({ day: "2026-11-12" });
  });

  test("day 2, a Friday: a quiet day and a 5-star; the brief has yesterday's simulated takings; still nothing written to Google", async () => {
    const sim = await import("@/lib/simulation");
    await sim.nextSimulatedDay(PZ, "me@builder.dev");
    ownerSaysHi();
    await sim.injectReview(PZ, 5, "me@builder.dev");
    sent.length = 0;
    const day = await runDay();
    show("Day 2 (Fri 13 Nov): WhatsApp", sent);
    expect(day.results?.filter((x) => x.error)).toEqual([]);
    expect(day.results?.map((x) => x.label)).toEqual(["Review check", "Nightly forecast", "Held sends released", "Morning brief"]);
    expect(sent.some((t) => /🧪 Simulated day: Friday, 13 November 2026./.test(t))).toBe(true);
    expect(r().last_brief_on).toBe("2026-11-13");
    await sim.injectZReport(PZ, { quiet: true }, "me@builder.dev");
    expect(db.tables.sales_days.filter((d) => d.simulated).map((d) => d.day).sort()).toEqual(["2026-11-12", "2026-11-13"]);
    expect(googleWrites).toEqual([]);
  });

  test("Stop: back to real time with nothing simulated left for a real forecast, brief or rota", async () => {
    const sim = await import("@/lib/simulation");
    const counts = await sim.stopSimulation(PZ, "me@builder.dev");
    expect(counts).toMatchObject({ sales_days: 2, reviews: 2 });
    expect(db.tables.sales_days.filter((d) => d.simulated)).toEqual([]);
    expect(db.tables.sales_days).toHaveLength(361); // the imported year, untouched
    expect(db.tables.rota_weeks.filter((w) => w.week_start === "2026-11-16")).toEqual([]);
    expect(db.tables.drafts.filter((d) => ["pending", "approved", "queued"].includes(String(d.status)))).toEqual([]);
    expect(r()).toMatchObject({ fake_now: null, simulation: null, last_brief_on: "2026-11-01" });
    expect(googleWrites).toEqual([]);
  });
});
