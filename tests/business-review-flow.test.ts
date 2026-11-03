// The business review's guided flow (lib/review/flow.ts, flow-run.ts), step 3:
// Let's go / GO starts it; one step at a time with its buttons; "Next?" after
// each; Next passes over a step; STOP ends it (the rest waits in the brief) and
// GO carries on; a typed 1/2/3 means the button on screen; old buttons are refused.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import { nextStep, parseFlowButton, parseFlowWords } from "@/lib/review/flow";

const R = "ffffffff-0000-4000-8000-000000000058";
const RV = "ffffffff-0000-4000-8000-00000000a058";
const OWNER = "whatsapp:+447700900158";
const SANDBOX = "whatsapp:+14155238886";

describe("flow rules", () => {
  test("the next step is the first in order not done that has something in it", () => {
    expect(nextStep([], ["poster", "replies"])).toBe("replies");
    expect(nextStep(["replies"], ["poster", "replies"])).toBe("poster");
    expect(nextStep(["replies", "poster"], ["poster", "replies"])).toBeNull();
  });

  test("buttons and words", () => {
    expect(parseFlowButton(`review:${RV}:go`)).toEqual({ reviewId: RV, input: { kind: "go" } });
    expect(parseFlowButton(`review:${RV}:replies:all`)).toEqual({ reviewId: RV, input: { kind: "choose", step: "replies", choice: "all" } });
    expect(parseFlowButton("review:open")).toBeNull();
    expect(parseFlowButton("approve:abc")).toBeNull();
    expect(parseFlowWords("GO", { flowOn: false, draftOnScreen: false })).toEqual({ kind: "go" });
    expect(parseFlowWords("Let's go!", { flowOn: false, draftOnScreen: false })).toEqual({ kind: "go" });
    expect(parseFlowWords("start", { flowOn: true, draftOnScreen: false })).toBeNull(); // never START (Twilio's opt-in word)
    expect(parseFlowWords("next", { flowOn: false, draftOnScreen: false })).toBeNull(); // NEXT is the queue's command when the flow isn't on
    expect(parseFlowWords("Next", { flowOn: true, draftOnScreen: false })).toEqual({ kind: "next" });
    expect(parseFlowWords("later", { flowOn: true, draftOnScreen: false })).toEqual({ kind: "stop" });
    expect(parseFlowWords("2", { flowOn: true, draftOnScreen: false })).toEqual({ kind: "number", n: 2 });
    expect(parseFlowWords("2", { flowOn: true, draftOnScreen: true })).toBeNull(); // Edit, for the draft on screen
  });
});

let db: ReturnType<typeof memoryDb>;
const out: { text: string; buttons: string[] }[] = [];

beforeEach(() => {
  vi.resetModules();
  out.length = 0;
  db = memoryDb({
    restaurants: [{ id: R, name: "Ember & Spice", slug: "ember-spice", owner_whatsapp: OWNER, whatsapp_from: SANDBOX, is_demo: true }],
    business_reviews: [{ id: RV, restaurant_id: R, status: "sent", flow_state: {}, flow_step: null, flow_started_at: null, flow_ended_at: null, created_at: "2026-11-03T10:00:00Z" }],
    drafts: [],
    audit_log: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/notify", () => ({ sendAndLog: async (_c: unknown, deliver: () => Promise<unknown>) => void (await deliver()) }));
  vi.doMock("@/lib/whatsapp", () => ({
    sendDinaChoices: async (_f: string, _t: string, m: { body: string; options: { id: string }[] }) => (out.push({ text: m.body, buttons: m.options.map((o) => o.id) }), { sid: "SM", body: m.body }),
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/notify", "@/lib/whatsapp"]) vi.doUnmock(m);
});

const review = () => db.tables.business_reviews[0];

async function setup() {
  const flow = await import("@/lib/review/flow-run");
  const choices: string[] = [];
  flow.setFlowHandlersForTests({
    replies: {
      available: async () => true,
      show: async (ctx) => (await ctx.say("💬 22 replies are ready.", [ctx.button("replies", "all", "Approve all 18"), ctx.button("replies", "one", "One by one"), ctx.button("replies", "skip", "Skip")]), "stay"),
      choose: async (_ctx, c) => (choices.push(c), "done"),
    },
    profile: { available: async () => false, show: async () => "done", choose: async () => "done" },
    poster: {
      available: async () => true,
      show: async (ctx) => (await ctx.say("🪧 Here's your poster."), "done"),
      choose: async () => "done",
    },
  });
  const turn = { ctx: { restaurantId: R, restaurant: db.tables.restaurants[0], now: new Date() }, channel: { restaurantId: R, from: SANDBOX, to: OWNER }, owner: OWNER, send: async (t: string) => void (t && out.push({ text: t, buttons: [] })) } as never;
  const msg = (body: string, payload?: string) => flow.handleReviewFlow(turn, body, payload);
  return { msg, choices };
}

describe("the guided flow", () => {
  test("Let's go, a step's button, Next?, then the poster and the end", async () => {
    const { msg, choices } = await setup();
    expect(await msg("", `review:${RV}:go`)).toBe(true);
    expect(out.at(-1)).toEqual({ text: "💬 22 replies are ready.", buttons: [`review:${RV}:replies:all`, `review:${RV}:replies:one`, `review:${RV}:replies:skip`] });
    expect(await msg("", `review:${RV}:replies:all`)).toBe(true);
    expect(choices).toEqual(["all"]);
    expect(out.at(-1)).toEqual({ text: "Next? Up next: your QR poster.", buttons: [`review:${RV}:next`, `review:${RV}:stop`] });
    expect(await msg("Next")).toBe(true);
    expect(out.map((o) => o.text).slice(-2)).toEqual(["🪧 Here's your poster.", expect.stringMatching(/^That's everything from your review/)]);
    expect(review().flow_ended_at).toEqual(expect.any(String));
    expect(db.tables.audit_log.map((a) => a.detail)).toEqual(["Started going through the business review", "Went through the business review to the end"]);
  });

  test("a typed number means the button on screen", async () => {
    const { msg, choices } = await setup();
    await msg("go");
    expect(await msg("2")).toBe(true);
    expect(choices).toEqual(["one"]);
  });

  test("STOP ends it (the rest waits in the brief); GO carries on where it was", async () => {
    const { msg } = await setup();
    await msg("GO");
    expect(await msg("stop")).toBe(true);
    expect(out.at(-1)!.text).toMatch(/waiting for you in tomorrow morning's brief/);
    expect(review().flow_ended_at).toEqual(expect.any(String));
    // Once stopped, Next is the queue's command again, not the flow's.
    expect(await msg("next")).toBe(false);
    expect(await msg("GO")).toBe(true);
    expect(out.at(-1)!.text).toBe("💬 22 replies are ready.");
  });

  test("Next on a step passes over it (its drafts wait in the brief)", async () => {
    const { msg, choices } = await setup();
    await msg("GO");
    await msg("next");
    expect(choices).toEqual([]);
    expect(out.map((o) => o.text).slice(-2)).toEqual(["🪧 Here's your poster.", expect.stringMatching(/^That's everything/)]);
  });

  test("a button from an older review, and words when nothing's going on", async () => {
    const { msg } = await setup();
    expect(await msg("", "review:aaaaaaaa-0000-4000-8000-000000000000:go")).toBe(true);
    expect(out.at(-1)!.text).toMatch(/older review/);
    expect(await msg("hello")).toBe(false);
    expect(await msg("2")).toBe(false);
  });

  test("not sent yet (waiting for the owner): GO isn't the flow's", async () => {
    review().status = "waiting_window";
    const { msg } = await setup();
    expect(await msg("GO")).toBe(false);
  });
});
