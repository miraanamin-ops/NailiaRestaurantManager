// WhatsApp's 24-hour window (step 46, lib/outbox.ts): a proactive message to an
// owner who hasn't messaged in 24 hours is held, an opener template goes on a
// real sender (not twice while unanswered), and everything held goes out once
// on the owner's next message.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";

const R = "eeeeeeee-0000-4000-8000-000000000062";
const OWNER = "whatsapp:+447700900162";
const FROM = "whatsapp:+447403690497";
const channel = { restaurantId: R, from: FROM, to: OWNER };

let db: ReturnType<typeof memoryDb>;
let sandbox = false;
const sent: { kind: string; body: string }[] = [];

function lastInbound(hoursAgo: number) {
  db.tables.messages.push({ id: `in-${hoursAgo}`, restaurant_id: R, direction: "inbound", from_number: OWNER, body: "hi", created_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString() });
}

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
  sandbox = false;
  db = memoryDb({
    restaurants: [{ id: R, name: "Ember & Spice Grill", owner_name: "Sam Ahmed", owner_whatsapp: OWNER, whatsapp_from: FROM, last_opener_at: null }],
    messages: [],
    owner_outbox: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/onboarding/channel", async (orig) => ({ ...(await orig<object>()), isSandbox: () => sandbox }));
  vi.doMock("@/lib/whatsapp", () => ({
    sendText: async (_f: string, _t: string, body: string) => (sent.push({ kind: "text", body }), { sid: "SM1", body }),
    sendImage: async (_f: string, _t: string, _u: string, c: string) => (sent.push({ kind: "image", body: c }), { sid: "SM2", body: c }),
    sendWithApprovalButtons: async (_f: string, _t: string, body: string) => (sent.push({ kind: "buttons", body }), { sid: "SM3", body }),
    sendOpenerTemplate: async (_f: string, _t: string, kind: string, vars: Record<string, string>) => (sent.push({ kind: `opener:${kind}`, body: JSON.stringify(vars) }), { sid: "SM4", body: kind }),
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/onboarding/channel", "@/lib/whatsapp"]) vi.doUnmock(m);
});

describe("the outbox", () => {
  test("inside the window: sent straight away, nothing held", async () => {
    lastInbound(2);
    const { messageOwner } = await import("@/lib/notify");
    await messageOwner(channel, "Next week's rota is ready", false, { opener: "rota" });
    expect(sent.map((s) => s.kind)).toEqual(["text"]);
    expect(db.tables.owner_outbox).toHaveLength(0);
  });

  test("outside the window: held, one opener, then delivered once on the owner's next message", async () => {
    lastInbound(30);
    const { messageOwner } = await import("@/lib/notify");
    await messageOwner(channel, "🚨 *2-star review just came in.* I've drafted a careful reply", true, { opener: "alert" });
    await messageOwner(channel, "Next week's rota is ready", false, { opener: "rota" });
    // The review opener went; the rota's didn't (the review's is still unanswered).
    expect(sent.map((s) => s.kind)).toEqual(["opener:review"]);
    expect(JSON.parse(sent[0].body)).toEqual({ 1: "Sam", 2: "Ember & Spice Grill", 3: "2" });
    expect(db.tables.owner_outbox).toHaveLength(2);

    sent.length = 0;
    lastInbound(0);
    const { deliverOutbox } = await import("@/lib/outbox");
    expect(await deliverOutbox(R, channel)).toBe(2);
    expect(sent.map((s) => s.kind)).toEqual(["buttons", "text"]); // oldest first, buttons kept
    expect(await deliverOutbox(R, channel)).toBe(0); // never twice
  });

  test("a redeemed reward is held without an opener", async () => {
    lastInbound(30);
    const { messageOwner } = await import("@/lib/notify");
    await messageOwner(channel, "🎁 Reward redeemed", false, { opener: "none" });
    expect(sent).toHaveLength(0);
    expect(db.tables.owner_outbox).toHaveLength(1);
  });

  test("on the sandbox: held, no template (it can't be sent there)", async () => {
    sandbox = true;
    lastInbound(30);
    const { messageOwner } = await import("@/lib/notify");
    await messageOwner(channel, "Next week's rota is ready", false, { opener: "rota" });
    expect(sent).toHaveLength(0);
    expect(db.tables.owner_outbox).toHaveLength(1);
  });

  test("replies to the owner (no opener) are never held", async () => {
    const { messageOwner } = await import("@/lib/notify");
    await messageOwner(channel, "Done!");
    expect(sent.map((s) => s.kind)).toEqual(["text"]);
  });

  test("held messages over a week old are dropped as stale", async () => {
    db.tables.owner_outbox.push({ id: "old", restaurant_id: R, created_at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString(), payload: { text: "old", withButtons: false, mediaUrl: null }, sent_at: null, expired_at: null });
    const { deliverOutbox } = await import("@/lib/outbox");
    expect(await deliverOutbox(R, channel)).toBe(0);
    expect(sent).toHaveLength(0);
    expect(db.tables.owner_outbox[0].expired_at).toBeTruthy();
  });

  test("the brief opener counts what's waiting", async () => {
    lastInbound(30);
    const { sendBriefOpener } = await import("@/lib/outbox");
    const r = db.tables.restaurants[0] as never;
    expect(await sendBriefOpener(r, channel, 3, new Date())).toBe(true);
    expect(JSON.parse(sent[0].body)[3]).toBe("3 things to approve");
    expect(db.tables.restaurants[0].last_opener_at).toBeTruthy();
  });
});
