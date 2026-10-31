// Phase 8: the end of setup with Dina and the builder's test controls, on the
// in-memory database. Finishing needs WhatsApp linked, closes both setup records
// (so WhatsApp never falls back into the older setup) and switches the restaurant
// on only if its access allows; the summary card says what each step holds; the
// test controls only ever touch test restaurants (Google accepted works for any).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { summaryFrom } from "@/lib/onboarding/dina/view";
import { memoryDb } from "./support/memory-db";

const R = "dddddddd-0000-4000-8000-0000000000b8";
const REAL = "dddddddd-0000-4000-8000-0000000000b9";
let db: ReturnType<typeof memoryDb>;
const callDina = vi.fn();
const usage = { purpose: "turn", model: "claude-sonnet-5-5", tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.003 } };
const answer = (text: string, component: unknown = null) => ({ reply: { messages: [{ text, component }] }, calls: [usage], toolCalls: [], attempts: 1 });
const ALL = ["hello", "google", "tone", "make_it_right", "menu", "hours_faqs"];

beforeEach(() => {
  vi.resetModules();
  callDina.mockReset();
  process.env.BUILDER_WHATSAPP = "whatsapp:+447700900999";
  db = memoryDb(
    {
      restaurants: [
        { id: R, name: "Test Kitchen 1234", slug: "test-kitchen-1234", owner_name: "Test Owner", is_test: true, is_demo: true, billing_exempt: true, active: false, owner_whatsapp: null, menu: [], profile_version: 0 },
        { id: REAL, name: "Real Grill", slug: "real-grill", is_test: false, is_demo: false, active: false, owner_whatsapp: "whatsapp:+447700900999", menu: [], profile_version: 0 },
      ],
      onboarding_sessions: [
        { restaurant_id: R, flow_version: 2, current_step: "hours_faqs", channel_last_used: "web", started_at: "2026-10-31T10:00:00Z", completed_at: null, updated_at: "2026-10-31T10:00:00Z" },
        { restaurant_id: REAL, flow_version: 2, current_step: "google", channel_last_used: "whatsapp", started_at: "2026-10-31T09:00:00Z", completed_at: null, updated_at: "2026-10-28T09:00:00Z" },
      ],
      onboarding: [
        { restaurant_id: R, completed_at: null },
        { restaurant_id: REAL, completed_at: null },
      ],
      onboarding_steps: [
        ...ALL.slice(0, 5).map((k) => ({ restaurant_id: R, step_key: k, status: k === "menu" ? "partial" : "done", data: {}, completed_at: "2026-10-31T10:05:00Z" })),
        { restaurant_id: REAL, step_key: "hello", status: "done", data: {} },
        { restaurant_id: REAL, step_key: "google", status: "in_progress", waiting_on: "google", data: { invited_at: "2026-10-31T09:10:00Z" } },
      ],
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      reviews: [],
      messages: [],
      google_connections: [],
      jobs: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "sent" }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, structuredClone(fields)),
  }));
  vi.doMock("@/lib/onboarding/dina/call", async (orig) => ({ ...(await orig<object>()), callDina, routeStep: async () => ({ step: null, call: usage }) }));
  vi.doMock("@/lib/feeds/backfill", () => ({ enqueueBackfill: async () => null }));
  vi.doMock("@/lib/whatsapp", () => ({ sendText: async (_f: string, _t: string, body: string) => ({ sid: "SM", body }) }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/ops/menu", "@/lib/onboarding/dina/call", "@/lib/feeds/backfill", "@/lib/whatsapp"]) vi.doUnmock(m);
  delete process.env.BUILDER_WHATSAPP;
});

const r = (id = R) => db.tables.restaurants.find((x) => x.id === id)!;
const session = (id = R) => db.tables.onboarding_sessions.find((x) => x.restaurant_id === id)!;
const finishLastStep = () => db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "hours_faqs", status: "done", data: { answers: { parking: "Yes" } }, completed_at: "2026-10-31T11:00:00Z" });

describe("finishing setup", () => {
  test("every step dealt with but no WhatsApp: not finished; the summary and one 'link your WhatsApp' (not repeated)", async () => {
    finishLastStep();
    callDina.mockResolvedValue(answer("That's every step dealt with."));
    const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
    const out = await dinaTurn({ restaurantId: R, channel: "web", event: "message", text: "ok", externalId: "a" });
    expect(out.duplicate === false && out.messages.map((m) => m.component?.type ?? null)).toEqual([null, "summary", "whatsapp_link"]);
    expect(session().completed_at).toBeNull();
    expect(r().active).toBe(false);
    await new Promise((res) => setTimeout(res, 3));
    const again = await dinaTurn({ restaurantId: R, channel: "web", event: "message", text: "anything else?", externalId: "b" });
    expect(again.duplicate === false && again.messages.map((m) => m.component?.type ?? null)).toEqual([null]); // nothing repeated
  });

  test("with WhatsApp linked: both setup records closed, switched on (exempt), the summary added once; then nothing more", async () => {
    finishLastStep();
    r().owner_whatsapp = "whatsapp:+447700900111";
    callDina.mockResolvedValue(answer("All done!", { type: "summary" }));
    const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
    const out = await dinaTurn({ restaurantId: R, channel: "web", event: "message", text: "ok", externalId: "c" });
    expect(out.duplicate === false && out.messages.map((m) => m.component?.type ?? null)).toEqual(["summary"]);
    expect(session().completed_at).toEqual(expect.any(String));
    expect(db.tables.onboarding.find((o) => o.restaurant_id === R)?.completed_at).toEqual(expect.any(String));
    expect(r().active).toBe(true);
    const { finishIfDone } = await import("@/lib/onboarding/dina/finish");
    expect(await finishIfDone(R)).toBeNull();
  });

  test("a restaurant with no access (no exemption, pilot code or subscription) finishes but stays off", async () => {
    finishLastStep();
    Object.assign(r(), { owner_whatsapp: "whatsapp:+447700900111", billing_exempt: false });
    const { finishIfDone } = await import("@/lib/onboarding/dina/finish");
    expect(await finishIfDone(R)).toEqual({ finished: true, active: false });
    expect(r().active).toBe(false);
  });

  test("not finished while a step is still open", async () => {
    const { finishIfDone } = await import("@/lib/onboarding/dina/finish");
    expect(await finishIfDone(R)).toBeNull();
  });
});

describe("the summary card", () => {
  test("each step's detail from what's saved, a Change link each, waiting steps shown, what happens next", () => {
    const state = {
      hello: { status: "done" as const, data: {}, waitingOn: null, startedAt: null, completedAt: null, skippedAt: null },
      google: { status: "in_progress" as const, data: {}, waitingOn: "google", startedAt: null, completedAt: null, skippedAt: null },
      make_it_right: { status: "done" as const, data: { offers: ["A free dessert"], handler: "Amina" }, waitingOn: null, startedAt: null, completedAt: null, skippedAt: null },
      menu: { status: "partial" as const, data: { allergens: { total: 12, confirmed: 9, unknown: 3 } }, waitingOn: null, startedAt: null, completedAt: null, skippedAt: null },
      tone: { status: "skipped" as const, data: { queued: 2 }, waitingOn: null, startedAt: null, completedAt: null, skippedAt: null },
    };
    const s = summaryFrom({ restaurant: { id: R, slug: "ember", name: "Ember Grill", cuisine: "Grill", address: "1 High St" }, state });
    expect(s.items.map((i) => [i.title, i.status, i.detail])).toEqual([
      ["Hello", "done", "Ember Grill, Grill, 1 High St"],
      ["Google profile", "waiting", "Invited: waiting for Google to accept"],
      ["Making it right", "done", "A free dessert. Complaints go to Amina."],
      ["Your menu", "partial", "12 dishes; allergens confirmed for 9, 3 still to check"],
    ]);
    expect(s.items[0].editHref).toBe(`/onboarding/chat?r=${R}&step=hello`);
    expect(s.locked.map((l) => l.title)).toEqual(["Your tone", "Your menu"]);
    expect(s.next).toEqual(expect.arrayContaining(["2 review replies are waiting for your approval in that first brief.", "Your QR codes are ready to print: /r/ember/qr-pack"]));
  });
});

describe("the builder's test controls", () => {
  test("start: a test restaurant (a demo, exempt) with setup started on the web", async () => {
    const { startTestSite } = await import("@/lib/onboarding/dina/test-sites");
    const id = await startTestSite();
    expect(r(id)).toMatchObject({ is_test: true, is_demo: true, billing_exempt: true, active: false, owner_email: expect.stringMatching(/@dinerai\.test$/) });
    expect(session(id)).toMatchObject({ current_step: "hello", channel_last_used: "web" });
  });

  test("reset to step 1: conversation, steps and gaps gone, details cleared, the WhatsApp link kept", async () => {
    Object.assign(r(), { owner_whatsapp: "whatsapp:+447700900111", address: "1 High St", faqs: { parking: "Yes" }, active: true });
    db.tables.onboarding_messages.push({ id: "m1", restaurant_id: R, role: "dina", body: "hi", parts: [] });
    db.tables.setup_gaps.push({ restaurant_id: R, step_key: "menu" });
    const { resetTestSite } = await import("@/lib/onboarding/dina/test-sites");
    await resetTestSite(R);
    expect(db.tables.onboarding_steps.filter((s) => s.restaurant_id === R)).toEqual([]);
    expect(db.tables.onboarding_messages).toEqual([]);
    expect(db.tables.setup_gaps).toEqual([]);
    expect(session()).toMatchObject({ current_step: "hello", completed_at: null });
    expect(r()).toMatchObject({ active: false, address: null, faqs: {}, owner_whatsapp: "whatsapp:+447700900111" });
  });

  test("jump to a step; a step that isn't built is refused", async () => {
    const { jumpTestSite } = await import("@/lib/onboarding/dina/test-sites");
    await jumpTestSite(R, "tone");
    expect(session().current_step).toBe("tone");
    await expect(jumpTestSite(R, "sales")).rejects.toThrow(/isn't a step in setup/);
  });

  test("reset, delete and link never touch a real restaurant", async () => {
    const t = await import("@/lib/onboarding/dina/test-sites");
    for (const act of [t.resetTestSite, t.deleteTestSite, t.linkBuilderNumber, (id: string) => t.jumpTestSite(id, "tone")]) await expect(act(REAL)).rejects.toThrow(/isn't a test restaurant/);
    expect(r(REAL)).toBeTruthy();
  });

  test("link my WhatsApp: refused while it's a real restaurant's owner number; moved from another test restaurant", async () => {
    const t = await import("@/lib/onboarding/dina/test-sites");
    await expect(t.linkBuilderNumber(R)).rejects.toThrow(/owner number of Real Grill/);
    r(REAL).owner_whatsapp = null;
    const other = await t.startTestSite();
    await t.linkBuilderNumber(other);
    await t.linkBuilderNumber(R);
    expect(r().owner_whatsapp).toBe("whatsapp:+447700900999");
    expect(r(other).owner_whatsapp).toBeNull();
  });

  test("delete: the test restaurant goes", async () => {
    const { deleteTestSite } = await import("@/lib/onboarding/dina/test-sites");
    await deleteTestSite(R);
    expect(db.tables.restaurants.map((x) => x.id)).toEqual([REAL]);
  });

  test("mark Google accepted works for a real restaurant setting up; Dina tells the owner", async () => {
    const { markAcceptedByBuilder, setupsForAdmin } = await import("@/lib/onboarding/dina/test-sites");
    const before = await setupsForAdmin();
    expect(before.find((s) => s.id === REAL)).toMatchObject({ google: "Invited: waiting", googleWaiting: true, stalled: true });
    expect(await markAcceptedByBuilder(REAL)).toMatch(/^I'm in! Your profile has no reviews yet/);
    expect(db.tables.onboarding_steps.find((s) => s.restaurant_id === REAL && s.step_key === "google")?.status).toBe("done");
    expect(db.tables.onboarding_messages.at(-1)).toMatchObject({ restaurant_id: REAL, role: "dina", body: expect.stringMatching(/^I'm in!/) });
  });
});
