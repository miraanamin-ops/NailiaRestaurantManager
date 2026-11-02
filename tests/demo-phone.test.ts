// The builder's demo phone (lib/demo-phone.ts): it only acts for a demo
// restaurant on a placeholder number, a message goes in like a WhatsApp one (the
// same queued job), and nothing is ever sent to a placeholder number.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeAfter, flushAfter } from "./support/after";
import { memoryDb } from "./support/memory-db";

const EMBER = "11111111-1111-1111-1111-111111111111";
const CARDAMOM = "22222222-2222-2222-2222-222222222222";
const REAL = "33333333-3333-3333-3333-333333333333";
const OLD_DEMO = "44444444-4444-4444-4444-444444444444";

let db: ReturnType<typeof memoryDb>;
const enqueue = vi.fn(async (_job: Record<string, unknown>) => ({ id: "job1" }));

beforeEach(() => {
  vi.resetModules();
  enqueue.mockClear();
  db = memoryDb({
    restaurants: [
      { id: EMBER, name: "Ember & Spice Grill", slug: "ember-spice", is_demo: true, owner_whatsapp: "whatsapp:+447700900401", whatsapp_from: "whatsapp:+14155238886" },
      { id: CARDAMOM, name: "Cardamom Corner Café", slug: "cardamom-corner", is_demo: true, owner_whatsapp: "whatsapp:+447700900402", whatsapp_from: null },
      { id: REAL, name: "Pilot Zero Hall", slug: "pilot-zero", is_demo: false, owner_whatsapp: "whatsapp:+447700900402x", whatsapp_from: null },
      { id: OLD_DEMO, name: "Old demo", slug: "old-demo", is_demo: true, owner_whatsapp: "whatsapp:+447700900123", whatsapp_from: null },
    ],
    messages: [],
    audit_log: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/queue/store", () => ({ enqueue }));
  vi.doMock("@/lib/queue/kick", () => ({ kickWorkers: vi.fn(async () => {}) }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
});

afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/queue/store");
  vi.doUnmock("@/lib/queue/kick");
  vi.doUnmock("next/server");
});

describe("the demo phone", () => {
  test("lists only demo restaurants on a placeholder number", async () => {
    const { demoPhones } = await import("@/lib/demo-phone");
    expect((await demoPhones()).map((r) => r.slug).sort()).toEqual(["cardamom-corner", "ember-spice"]);
  });

  test("a message goes in as the demo owner's: logged, then the same queued job as a WhatsApp message", async () => {
    const { sendAsDemoOwner } = await import("@/lib/demo-phone");
    await sendAsDemoOwner(EMBER, "  RUN BRIEF ", "me@builder.dev");
    await flushAfter();
    const inbound = db.tables.messages.filter((m) => m.direction === "inbound");
    expect(inbound).toEqual([expect.objectContaining({ restaurant_id: EMBER, from_number: "whatsapp:+447700900401", body: "RUN BRIEF", status: "received" })]);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      type: "owner_message",
      restaurantId: EMBER,
      payload: { kind: "owner", owner: "whatsapp:+447700900401", sandbox: "whatsapp:+14155238886", body: "RUN BRIEF" },
    });
    expect(db.tables.audit_log[0]).toMatchObject({ restaurant_id: EMBER, actor: "builder", action: "demo_phone" });
  });

  test("refuses a real restaurant, and a demo one on a real-looking number; nothing is logged or queued", async () => {
    const { sendAsDemoOwner, DemoPhoneError } = await import("@/lib/demo-phone");
    for (const id of [REAL, OLD_DEMO, "55555555-5555-5555-5555-555555555555"]) {
      await expect(sendAsDemoOwner(id, "hi", "me@builder.dev")).rejects.toBeInstanceOf(DemoPhoneError);
    }
    expect(db.tables.messages).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("an empty message is refused", async () => {
    const { sendAsDemoOwner } = await import("@/lib/demo-phone");
    await expect(sendAsDemoOwner(EMBER, "   ", "me@builder.dev")).rejects.toThrow(/Type a message/);
  });

  test("the conversation is that restaurant's only, oldest first", async () => {
    db.tables.messages.push(
      { id: "m1", restaurant_id: EMBER, direction: "inbound", body: "hi", created_at: "2026-11-01T10:00:00Z", status: "received" },
      { id: "m2", restaurant_id: EMBER, direction: "outbound", body: "hello", created_at: "2026-11-01T10:00:05Z", status: "sent" },
      { id: "m3", restaurant_id: CARDAMOM, direction: "inbound", body: "other", created_at: "2026-11-01T10:01:00Z", status: "received" },
    );
    const { demoConversation } = await import("@/lib/demo-phone");
    expect((await demoConversation(EMBER)).messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});

describe("nothing is sent to a placeholder number", () => {
  test("Twilio is never called; the message gets a placeholder id", async () => {
    const create = vi.fn();
    vi.doMock("twilio", () => ({ default: () => ({ messages: { create } }) }));
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    const { sendText, PLACEHOLDER_SID } = await import("@/lib/whatsapp");
    const sent = await sendText("whatsapp:+14155238886", "whatsapp:+447700900401", "Your morning brief");
    expect(sent.sid.startsWith(PLACEHOLDER_SID)).toBe(true);
    expect(create).not.toHaveBeenCalled();
    vi.doUnmock("twilio");
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });
});
