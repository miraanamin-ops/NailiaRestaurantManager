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
// The job queue: what the webhook queued, and whether queuing works.
let queued: { type: string; restaurantId: string | null; key: string; priority?: number; concurrencyKey?: string | null; payload?: Record<string, unknown> }[] = [];
let queueBroken = false;
let kicks = 0;
const alerts: string[] = [];
const sentToOwner: string[] = [];
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
  queued = [];
  queueBroken = false;
  kicks = 0;
  alerts.length = 0;
  sentToOwner.length = 0;
  vi.doMock("@/lib/queue/store", () => ({
    enqueue: async (job: (typeof queued)[number]) => {
      if (queueBroken) throw new Error("enqueue_job: relation \"jobs\" does not exist");
      queued.push(job);
      return { id: `job${queued.length}` };
    },
  }));
  vi.doMock("@/lib/queue/kick", () => ({ kickWorkers: async () => ++kicks }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "ok") }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: async (_c: unknown, text: string) => void sentToOwner.push(text) }));
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
  vi.doUnmock("@/lib/queue/store");
  vi.doUnmock("@/lib/queue/kick");
  vi.doUnmock("@/lib/builder-alerts");
  vi.doUnmock("@/lib/notify");
  vi.resetModules();
});

async function post(params: Record<string, string>, signature: string | null) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/whatsapp/route");
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (signature !== null) headers["x-twilio-signature"] = signature;
  const res = await POST(new NextRequest(URL_, { method: "POST", body: new URLSearchParams(params), headers }));
  await flushAfter();
  // A worker answers what was queued (the real handler for WhatsApp messages).
  const { HANDLERS } = await import("@/lib/queue/handlers");
  for (const job of queued.splice(0)) {
    await HANDLERS.owner_message.run({ type: job.type, restaurant_id: job.restaurantId, payload: job.payload ?? {} } as never);
  }
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
  test("a message goes on the queue (owner replies first, one at a time per restaurant) and a worker starts", async () => {
    const m = message(OWNER, "SMq1");
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/whatsapp/route");
    const body = new URLSearchParams(m);
    await POST(new NextRequest(URL_, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(m) } }));
    await flushAfter();
    expect(queued).toEqual([
      {
        type: "owner_message",
        restaurantId: "r1",
        key: "owner_message:SMq1",
        priority: 0,
        concurrencyKey: "whatsapp:r1",
        payload: { kind: "owner", owner: OWNER, sandbox: "whatsapp:+14155238886", body: "APPROVE ALL", buttonPayload: undefined, listId: undefined, messageSid: "SMq1", media: [] },
      },
    ]);
    expect(kicks).toBe(1);
    expect(handleMessage).not.toHaveBeenCalled(); // not in the webhook: a worker answers it
  });
  test("if the queue can't take it, the message is answered here instead", async () => {
    queueBroken = true;
    const m = message(OWNER, "SMq2");
    await post(m, sign(m));
    expect(handleMessage).toHaveBeenCalledTimes(1);
    expect(kicks).toBe(0);
  });
  test("if answering it here fails too, the owner gets Sorry once and the builder is alerted", async () => {
    queueBroken = true;
    handleMessage.mockImplementationOnce(async () => {
      throw new Error("Supabase down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = message(OWNER, "SMq3");
    await post(m, sign(m));
    const { SORRY } = await import("@/lib/sorry");
    expect(sentToOwner).toEqual([SORRY]);
    expect(alerts[0]).toMatch(/couldn't be answered: Supabase down/);
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

describe("builder commands only from the builder's own number", () => {
  const BUILDER = "whatsapp:+447700900999";
  const handleBuilderCommand = vi.fn(async () => "✅ done");
  const sendText = vi.fn(async () => ({ sid: "SMb", body: "" }));
  beforeEach(() => {
    handleBuilderCommand.mockClear();
    sendText.mockClear();
    vi.doMock("@/lib/feeds/builder", () => ({ handleBuilderCommand }));
    vi.doMock("@/lib/whatsapp", async (orig) => ({ ...(await orig<object>()), sendText }));
  });
  afterEach(() => {
    vi.doUnmock("@/lib/feeds/builder");
    vi.doUnmock("@/lib/whatsapp");
    delete process.env.BUILDER_WHATSAPP;
  });
  const builderMessage = (from: string) => ({ ...message(from, `SMb${Math.random()}`), Body: "BUILDER GOOGLE ACCEPTED ember-spice" });

  test("a restaurant owner sending BUILDER ...: not run, not passed to their assistant, no reply at all", async () => {
    process.env.BUILDER_WHATSAPP = BUILDER;
    const m = builderMessage(OWNER);
    const res = await post(m, sign(m));
    expect(await res.text()).toContain("<Response></Response>");
    expect(handleBuilderCommand).not.toHaveBeenCalled();
    expect(handleMessage).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(sentToOwner).toEqual([]);
    const logged = db.calls.find((c) => c.table === "messages" && c.op === "insert");
    expect((logged?.payload as { error: string }).error).toMatch(/builder command from a number that isn't the builder's/);
  });

  test("a stranger, or anyone at all when no builder number is set: nothing", async () => {
    process.env.BUILDER_WHATSAPP = BUILDER;
    const stranger = builderMessage("whatsapp:+447700900555");
    await post(stranger, sign(stranger));
    delete process.env.BUILDER_WHATSAPP;
    const anyone = builderMessage(BUILDER);
    await post(anyone, sign(anyone));
    expect(handleBuilderCommand).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(handleMessage).not.toHaveBeenCalled();
  });

  test("the builder's own number: run, and the answer goes back to the builder only", async () => {
    process.env.BUILDER_WHATSAPP = BUILDER;
    const m = builderMessage(BUILDER);
    await post(m, sign(m));
    expect(handleBuilderCommand).toHaveBeenCalledWith("BUILDER GOOGLE ACCEPTED ember-spice");
    expect(sendText).toHaveBeenCalledWith("whatsapp:+14155238886", BUILDER, "✅ done");
  });
});
