// The WhatsApp webhook: only genuine Twilio messages from the owner get through,
// and a message delivered twice is acted on once.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import twilio from "twilio";
import { fakeAfter, flushAfter } from "./support/after";
import { fakeSupabase, type Call } from "./support/fake-supabase";

const TOKEN = "test-twilio-auth-token";
const URL_ = "https://naila.test/api/whatsapp";
const OWNER = "whatsapp:+447700900123";

const handleMessage = vi.fn(async () => {});
const linkFromWhatsApp = vi.fn(async () => {});
const handleOnboardingMessage = vi.fn(async () => {});
let settingUp = false;
let insertError: { message: string; code?: string } | null = null;
let db: ReturnType<typeof fakeSupabase>;

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  insertError = null;
  handleMessage.mockClear();
  linkFromWhatsApp.mockClear();
  handleOnboardingMessage.mockClear();
  settingUp = false;
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
  vi.doMock("@/lib/onboarding/whatsapp-flow", () => ({ linkFromWhatsApp, handleOnboardingMessage, onboardingInProgress: async () => settingUp }));
  vi.doMock("next/server", async (orig) => ({ ...(await orig<object>()), after: fakeAfter }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/bot");
  vi.doUnmock("@/lib/onboarding/whatsapp-flow");
  vi.doUnmock("next/server");
  vi.resetModules();
});

async function post(params: Record<string, string>, signature: string | null) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/whatsapp/route");
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (signature !== null) headers["x-twilio-signature"] = signature;
  const res = await POST(new NextRequest(URL_, { method: "POST", body: new URLSearchParams(params), headers }));
  await flushAfter();
  return res;
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

  test("a link code from the onboarding page links the number (even from a stranger)", async () => {
    const m = { ...message("whatsapp:+447700900555"), Body: "Link my restaurant: K7Q2MZ" };
    await post(m, sign(m));
    expect(linkFromWhatsApp).toHaveBeenCalledWith("K7Q2MZ", "whatsapp:+447700900555", "whatsapp:+14155238886");
    expect(handleMessage).not.toHaveBeenCalled();
  });
  test("an ordinary six-letter word isn't mistaken for a link code", async () => {
    const m = { ...message(), Body: "STATUS" };
    await post(m, sign(m));
    expect(linkFromWhatsApp).not.toHaveBeenCalled();
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
  test("an owner whose restaurant is still being set up gets onboarding, with every photo", async () => {
    settingUp = true;
    const m = { ...message(), Body: "", NumMedia: "2", MediaUrl0: "https://x/0", MediaContentType0: "image/jpeg", MediaUrl1: "https://x/1", MediaContentType1: "image/png" };
    await post(m, sign(m));
    expect(handleMessage).not.toHaveBeenCalled();
    const call = (handleOnboardingMessage.mock.calls[0] as unknown as [{ restaurantId: string; media: { url: string }[] }])[0];
    expect(call.restaurantId).toBe("r1");
    expect(call.media.map((x) => x.url)).toEqual(["https://x/0", "https://x/1"]);
  });
});
