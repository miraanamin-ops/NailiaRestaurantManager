// The WhatsApp webhook: only genuine Twilio messages from the owner get through,
// and a message delivered twice is acted on once.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import twilio from "twilio";
import { fakeSupabase, type Call } from "./support/fake-supabase";

const TOKEN = "test-twilio-auth-token";
const URL_ = "https://naila.test/api/whatsapp";
const OWNER = "whatsapp:+447700900123";

const handleMessage = vi.fn(async () => {});
let insertError: { message: string; code?: string } | null = null;
let db: ReturnType<typeof fakeSupabase>;

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  insertError = null;
  handleMessage.mockClear();
  db = fakeSupabase((call: Call) => {
    if (call.table === "restaurants") {
      const isOwner = call.filters.some((f) => f[0] === "eq" && f[1] === "owner_whatsapp" && f[2] === OWNER);
      return { data: isOwner ? { id: "r1" } : null };
    }
    if (call.table === "messages" && call.op === "insert") return { error: insertError };
    return { data: null };
  });
  vi.doMock("@/lib/supabase", () => ({ getSupabase: () => db.client }));
  vi.doMock("@/lib/bot", () => ({ handleMessage }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => fn() }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/bot");
  vi.doUnmock("next/server");
  vi.resetModules();
});

async function post(params: Record<string, string>, signature: string | null) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/whatsapp/route");
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (signature !== null) headers["x-twilio-signature"] = signature;
  return POST(new NextRequest(URL_, { method: "POST", body: new URLSearchParams(params), headers }));
}
const message = (from = OWNER, sid = "SM1") => ({ From: from, To: "whatsapp:+14155238886", Body: "APPROVE ALL", MessageSid: sid });
const sign = (params: Record<string, string>) => twilio.getExpectedTwilioSignature(TOKEN, URL_, params);

describe("the WhatsApp webhook", () => {
  test("rejects a message with no Twilio signature", async () => {
    const res = await post(message(), null);
    expect(res.status).toBe(403);
    expect(handleMessage).not.toHaveBeenCalled();
  });
  test("rejects a forged signature, or a signed message that was tampered with", async () => {
    expect((await post(message(), "bm90LXJlYWw=")).status).toBe(403);
    const signed = message();
    const sig = sign(signed);
    expect((await post({ ...signed, Body: "PAUSE" }, sig)).status).toBe(403);
    expect(handleMessage).not.toHaveBeenCalled();
  });
  test("a genuine message from the owner is handled", async () => {
    const m = message();
    const res = await post(m, sign(m));
    expect(res.status).toBe(200);
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
  test("a genuine message from anyone else is logged and ignored, with no reply", async () => {
    const m = message("whatsapp:+447700900555");
    const res = await post(m, sign(m));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<Response></Response>");
    expect(handleMessage).not.toHaveBeenCalled();
    const logged = db.calls.find((c) => c.table === "messages" && c.op === "insert");
    expect((logged?.payload as { error: string }).error).toMatch(/not a registered owner/);
  });
  test("the same message delivered twice is only acted on once", async () => {
    const m = message(OWNER, "SMdup");
    await post(m, sign(m));
    insertError = { message: "duplicate key", code: "23505" }; // the database refuses the second copy
    await post(m, sign(m));
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
});
