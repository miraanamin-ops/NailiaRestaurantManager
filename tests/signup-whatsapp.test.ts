// Linking WhatsApp to a Dina sign-up by its number (lib/onboarding/entry.ts and
// the webhook): the number typed at sign-up is linked by its first message, but
// never one that's already another restaurant's owner or a staff number (those
// stay where they are and the owner is shown the one-time code instead). Anyone
// else gets no reply at all.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import twilio from "twilio";
import { fakeAfter, flushAfter } from "./support/after";
import { memoryDb } from "./support/memory-db";

const TOKEN = "test-twilio-auth-token";
const URL_ = "https://app.test/api/whatsapp";
const SANDBOX = "whatsapp:+14155238886";
const N = "whatsapp:+447700900123"; // the number typed at sign-up
const NEW = "aaaaaaaa-0000-4000-8000-0000000000a1"; // the Dina sign-up
const OTHER = "bbbbbbbb-0000-4000-8000-0000000000b1"; // a running restaurant

const messageOwner = vi.fn<(c: unknown, t: string) => Promise<void>>(async () => {});
const replyUnregistered = vi.fn<(n: string, o: string, t?: string, d?: number) => Promise<void>>(async () => {});
const sendText = vi.fn(async () => ({ sid: "SMx", body: "" }));
const enqueue = vi.fn<(j: { restaurantId: string }) => Promise<object>>(async () => ({}));
const handleMessage = vi.fn(async () => {});
const logAction = vi.fn<(e: { detail: string }) => Promise<void>>(async () => {});
let db: ReturnType<typeof memoryDb>;

function seed(extra: { restaurants?: Record<string, unknown>[]; onboarding?: Record<string, unknown>[]; sessions?: Record<string, unknown>[]; staff?: Record<string, unknown>[] } = {}) {
  db = memoryDb(
    {
      restaurants: [{ id: NEW, name: "Rose Grill", owner_whatsapp: null, is_demo: false }, ...(extra.restaurants ?? [])],
      onboarding: [{ restaurant_id: NEW, pending_whatsapp: N, completed_at: null, link_code: "K7Q2MZ", link_code_expires_at: "2099-01-01T00:00:00Z" }, ...(extra.onboarding ?? [])],
      onboarding_sessions: extra.sessions ?? [{ restaurant_id: NEW, current_step: "hello", completed_at: null, flow_version: 2 }],
      staff_numbers: extra.staff ?? [],
      messages: [],
    },
    { unique: ["messages.twilio_sid"] },
  );
}

beforeEach(() => {
  vi.resetModules();
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  for (const f of [messageOwner, replyUnregistered, sendText, enqueue, handleMessage, logAction]) f.mockClear();
  seed();
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/notify", () => ({ messageOwner }));
  vi.doMock("@/lib/unregistered", () => ({ replyUnregistered }));
  vi.doMock("@/lib/whatsapp", () => ({ sendText }));
  vi.doMock("@/lib/queue/store", () => ({ enqueue }));
  vi.doMock("@/lib/queue/kick", () => ({ kickWorkers: async () => {} }));
  vi.doMock("@/lib/bot", () => ({ handleMessage }));
  vi.doMock("@/lib/audit", () => ({ logAction }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/notify", "@/lib/unregistered", "@/lib/whatsapp", "@/lib/queue/store", "@/lib/queue/kick", "@/lib/bot", "@/lib/audit", "next/server"]) vi.doUnmock(m);
});

async function post(from: string, body = "Hi Dina") {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/whatsapp/route");
  const params = { From: from, To: SANDBOX, Body: body, MessageSid: `SM${Math.random()}` };
  const sig = twilio.getExpectedTwilioSignature(TOKEN, URL_, params);
  const res = await POST(new NextRequest(URL_, { method: "POST", body: new URLSearchParams(params), headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig } }));
  await flushAfter();
  return res;
}
const restaurantRow = (id: string) => db.tables.restaurants.find((r) => r.id === id)!;

describe("the sign-up number", () => {
  test("its first message links it to the sign-up, and says so; the next message goes to that restaurant", async () => {
    expect((await post(N)).status).toBe(200);
    expect(restaurantRow(NEW)).toMatchObject({ owner_whatsapp: N, whatsapp_from: SANDBOX });
    expect(db.tables.onboarding[0].link_code).toBeNull();
    expect(messageOwner).toHaveBeenCalledWith({ restaurantId: NEW, from: SANDBOX, to: N }, expect.stringMatching(/Linked!.*Rose Grill/));
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: NEW, detail: expect.stringMatching(/number given at sign-up/) }));
    expect(enqueue).not.toHaveBeenCalled();

    await post(N, "carry on");
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: NEW }));
  });

  test("already another restaurant's owner: never linked automatically; the message stays with that restaurant", async () => {
    seed({ restaurants: [{ id: OTHER, name: "Old Grill", owner_whatsapp: N }] });
    await post(N);
    expect(restaurantRow(NEW).owner_whatsapp).toBeNull();
    expect(restaurantRow(OTHER).owner_whatsapp).toBe(N);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: OTHER }));
    expect(messageOwner).not.toHaveBeenCalledWith(expect.objectContaining({ restaurantId: NEW }), expect.anything());
  });

  test("already a staff number: never linked automatically; it stays a staff number", async () => {
    seed({ restaurants: [{ id: OTHER, name: "Old Grill", owner_whatsapp: "whatsapp:+447700900999" }], staff: [{ id: "s1", restaurant_id: OTHER, whatsapp: N, removed_at: null }] });
    await post(N);
    expect(restaurantRow(NEW).owner_whatsapp).toBeNull();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: OTHER }));
  });

  test("given for two sign-ups: neither is linked; it's told to use the code on the setup page", async () => {
    const SECOND = "cccccccc-0000-4000-8000-0000000000c1";
    seed({
      restaurants: [{ id: SECOND, name: "Rose Grill 2", owner_whatsapp: null }],
      onboarding: [{ restaurant_id: SECOND, pending_whatsapp: N, completed_at: null }],
      sessions: [
        { restaurant_id: NEW, completed_at: null },
        { restaurant_id: SECOND, completed_at: null },
      ],
    });
    await post(N);
    expect(restaurantRow(NEW).owner_whatsapp).toBeNull();
    expect(restaurantRow(SECOND).owner_whatsapp).toBeNull();
    expect(replyUnregistered).toHaveBeenCalledWith(N, SANDBOX, expect.stringMatching(/more than one restaurant.*code/), 3);
  });

  test("a sign-up from before Dina (no session) still links only by its code", async () => {
    seed({ sessions: [] });
    await post(N);
    expect(restaurantRow(NEW).owner_whatsapp).toBeNull();
    expect(messageOwner).not.toHaveBeenCalled();
  });
});

describe("anyone else", () => {
  test("gets no reply at all, and nothing happens", async () => {
    await post("whatsapp:+447700900555");
    expect(replyUnregistered).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(messageOwner).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(db.tables.messages).toEqual([expect.objectContaining({ from_number: "whatsapp:+447700900555", error: "Ignored: not a registered owner number" })]);
  });
});

describe("the 'You're in' page's check", () => {
  test("whatsappConflict says whose the number already is", async () => {
    seed({ restaurants: [{ id: OTHER, name: "Old Grill", owner_whatsapp: N }], staff: [{ id: "s1", restaurant_id: OTHER, whatsapp: "whatsapp:+447700900777", removed_at: null }] });
    const { whatsappConflict } = await import("@/lib/onboarding/entry");
    expect(await whatsappConflict(N, NEW)).toBe("owner");
    expect(await whatsappConflict(N, OTHER)).toBeNull(); // its own number
    expect(await whatsappConflict("whatsapp:+447700900777", NEW)).toBe("staff");
    expect(await whatsappConflict("whatsapp:+447700900888", NEW)).toBeNull();
    expect(await whatsappConflict(null, NEW)).toBeNull();
  });
});
