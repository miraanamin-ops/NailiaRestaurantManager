// The app's Chat tab (step 50, phase 3): the rules that turn the bot's WhatsApp
// messages into chat bubbles and quick replies; the chat turn (one answer per
// message, both sides logged, never a WhatsApp send, Sorry on failure); files only
// from the owner's own restaurant; "Answer in Chat"; the routes' login and
// restaurant checks; and the real bot answering a command into the app.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { APP_ADDRESS, chatButtons, chatDraftId, chatItems, checkUpload, fileLine, plainText, type MessageRow } from "@/lib/app/chat-rules";
import { memoryDb } from "./support/memory-db";

const D = "d0000000-0000-4000-8000-000000000001";
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const OWNER = "whatsapp:+447700900401";

describe("chat rules", () => {
  test("the quick replies are WhatsApp's buttons, with the ids the bot reads back", () => {
    expect(chatButtons(true).map((b) => b.id)).toEqual(["approve", "edit", "skip"]);
    expect(chatButtons({ draftId: D }).map((b) => b.id)).toEqual([`approve:${D}`, `edit:${D}`, `skip:${D}`]);
    expect(chatButtons({ draftId: D, buttons: "question" })).toEqual([
      { id: `public:${D}`, title: "Reply publicly" },
      { id: `private:${D}`, title: "Handle privately" },
      { id: `both:${D}`, title: "Both" },
    ]);
    expect(chatButtons({ draftId: D, buttons: "hours" }).map((b) => b.id)).toEqual([`same:${D}`, `closed:${D}`, `different:${D}`]);
    expect(chatButtons({ draftId: D, buttons: "choice", options: ["An offer", "A Google post", "No thanks", "extra"] })).toEqual([
      { id: `choose:${D}:1`, title: "An offer" },
      { id: `choose:${D}:2`, title: "A Google post" },
      { id: `choose:${D}:3`, title: "No thanks" },
    ]);
    expect(chatButtons({ draftId: D, buttons: "offer" }).map((b) => b.id)).toEqual([`quietoffer:${D}`, `noquiet:${D}`]);
    expect(chatButtons({ draftId: D, buttons: "reasons" }).map((b) => b.title)).toEqual(["Wrong tone", "Wrong offer", "Not now"]);
    expect(chatButtons(false)).toEqual([]);
  });

  test("the card a message shows: its draft, never a forecast row or a skipped draft", () => {
    expect(chatDraftId(true, D)).toBe(D);
    expect(chatDraftId({ draftId: D, buttons: "question" }, null)).toBe(D);
    expect(chatDraftId({ draftId: D, buttons: "offer" }, null)).toBeNull();
    expect(chatDraftId({ draftId: D, buttons: "reasons" }, null)).toBeNull();
    expect(chatDraftId(false, D)).toBeNull();
  });

  test("WhatsApp's *bold* and _italic_ become plain words; snake_case stays", () => {
    expect(plainText("*Photo post for Google*\n\n_📥 2 more waiting._")).toBe("Photo post for Google\n\n📥 2 more waiting.");
    expect(plainText("Reply *APPROVE 2* · *SKIP 2* about opening_hours")).toBe("Reply APPROVE 2 · SKIP 2 about opening_hours");
  });

  test("files: photos, PDFs, CSV and Excel; vague types go by the name; HEIC, .xls and big ones refused", () => {
    expect(checkUpload("image/jpeg", "IMG_1.JPG", 900_000)).toEqual({ ok: true, contentType: "image/jpeg", ext: "jpg", photo: true });
    expect(checkUpload("application/octet-stream", "takings.csv", 2000)).toMatchObject({ ok: true, contentType: "text/csv", photo: false });
    expect(checkUpload(null, "menu.pdf", 2000)).toMatchObject({ ok: true, contentType: "application/pdf", ext: "pdf" });
    expect(checkUpload("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "sales.xlsx", 2000)).toMatchObject({ ok: true, ext: "xlsx" });
    expect(checkUpload("image/heic", "IMG.HEIC", 900)).toMatchObject({ ok: false, reason: expect.stringMatching(/HEIC/) });
    expect(checkUpload("application/vnd.ms-excel", "old.xls", 900)).toMatchObject({ ok: false, reason: expect.stringMatching(/xlsx/) });
    expect(checkUpload("video/mp4", "clip.mp4", 900)).toMatchObject({ ok: false });
    expect(checkUpload("image/png", "big.png", 6 * 1024 * 1024)).toMatchObject({ ok: false, reason: expect.stringMatching(/5 MB/) });
    expect(checkUpload("application/pdf", "big.pdf", 17 * 1024 * 1024)).toMatchObject({ ok: false, reason: expect.stringMatching(/16 MB/) });
    expect(fileLine(true, "photo.jpg", " lamb chops ")).toBe("[📷 photo] lamb chops");
    expect(fileLine(false, "sales.csv", "")).toBe("[📄 sales.csv]");
  });

  test("history: buttons only since the owner last spoke, and gone once their draft is decided", () => {
    const row = (id: string, direction: "inbound" | "outbound", body: string, app: MessageRow["app"] = null, viaApp = true): MessageRow => ({
      id,
      direction,
      body,
      created_at: `2026-11-11T10:0${id}:00Z`,
      from_number: direction === "inbound" ? OWNER : viaApp ? APP_ADDRESS : "whatsapp:+14155238886",
      to_number: direction === "inbound" ? (viaApp ? APP_ADDRESS : "whatsapp:+14155238886") : OWNER,
      app,
    });
    const old = { buttons: chatButtons({ draftId: "old" }), draftId: "old" };
    const rows = [
      row("1", "outbound", "*Old draft*", old, false),
      row("2", "inbound", "Thursday is quiet"),
      row("3", "outbound", "Here's an offer", { buttons: chatButtons({ draftId: D }), draftId: D }),
      row("4", "outbound", "And a post", { buttons: chatButtons({ draftId: "gone" }), draftId: "gone" }),
    ];
    const items = chatItems(rows, new Set([D, "old"]));
    expect(items.map((i) => [i.from, i.channel, i.buttons.length, i.draftId])).toEqual([
      ["dinerai", "whatsapp", 0, "old"],
      ["owner", "app", 0, null],
      ["dinerai", "app", 3, D],
      ["dinerai", "app", 0, null],
    ]);
    expect(items[0].text).toBe("Old draft");
    const photo = chatItems([row("5", "inbound", "[📷 photo] our lamb chops", { file: { path: "a/b.jpg", name: "b.jpg", contentType: "image/jpeg" } })], new Set());
    expect(photo[0]).toMatchObject({ text: "our lamb chops", file: { name: "b.jpg", photo: true } });
  });
});

// ---------- The chat turn, on the in-memory database ----------

type Mem = ReturnType<typeof memoryDb>;
let mem: Mem;
let alerts: string[];
let botCalls: { body: string; buttonPayload?: string; media?: { url: string; contentType: string } | null }[];
let bot: (input: { app?: { owner: string; messages: unknown[] }; restaurantId: string }) => Promise<void>;
const twilioSends: string[] = [];

function seed() {
  return memoryDb(
    {
      restaurants: [
        { id: A, name: "Ember & Spice", owner_whatsapp: OWNER, whatsapp_from: "whatsapp:+14155238886", owner_email: "sam@ember.test" },
        { id: B, name: "Cardamom", owner_whatsapp: "whatsapp:+447700900402", owner_email: "other@x.test" },
      ],
      drafts: [
        { id: D, restaurant_id: A, kind: "review_question", status: "pending", content: "This review says they got ill. How should we handle it?", waiting_for: null, created_at: "2026-11-11T09:00:00Z" },
      ],
      messages: [],
    },
    { unique: ["messages.twilio_sid"] },
  );
}

beforeEach(() => {
  vi.resetModules();
  mem = seed();
  alerts = [];
  botCalls = [];
  twilioSends.length = 0;
  const storage = {
    from: (bucket: string) => ({
      ...mem.client.storage.from(bucket),
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${bucket}/${path}?token=u`, path, token: "u" }, error: null }),
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/${bucket}/${p}?token=x`, error: null })), error: null }),
    }),
  };
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => ({ ...mem.client, storage }) }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "ok") }));
  // Nothing in a chat turn may reach WhatsApp.
  const nope = async (_f: string, _t: string, body: string) => {
    twilioSends.push(body);
    throw new Error("WhatsApp was called");
  };
  vi.doMock("@/lib/whatsapp", async (orig) => ({ ...(await orig<object>()), sendText: nope, sendWithApprovalButtons: nope, sendImage: nope, sendDinaChoices: nope }));
  vi.doMock("@/lib/app/inbox", () => ({
    inboxCards: async (rid: string) => (mem.tables.drafts as { id: string; restaurant_id: string; status: string }[]).filter((d) => d.restaurant_id === rid && d.status === "pending").map((d) => ({ id: d.id, title: "Your call on a review", actions: "answer" })),
  }));
  // The bot stand-in answers the way the real one does: through messageOwner on its channel.
  bot = async (input) => {
    const { messageOwner } = await import("@/lib/notify");
    const channel = { restaurantId: input.restaurantId, from: "x", to: "whatsapp:+447700900489", app: input.app as never };
    await messageOwner(channel, "Here's an *offer* for Thursday", { draftId: D, buttons: "question" });
  };
  vi.doMock("@/lib/bot", () => ({
    handleMessage: async (input: Parameters<typeof bot>[0] & { body: string; buttonPayload?: string; media?: { url: string; contentType: string } | null }) => {
      botCalls.push({ body: input.body, buttonPayload: input.buttonPayload, media: input.media });
      return bot(input);
    },
  }));
});

afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/whatsapp", "@/lib/app/inbox", "@/lib/bot", "@/lib/assistant", "@/lib/outbox", "@/lib/followups", "@/lib/review/deliver", "@/lib/review/flow-run", "@/lib/morning", "@/lib/auth"]) vi.doUnmock(m);
});

const restaurantA = () => mem.tables.restaurants.find((r) => r.id === A) as never;
type Logged = { direction: string; from_number: string; to_number: string; body: string; twilio_sid: string; app: Record<string, unknown> | null; restaurant_id: string };
const logged = () => mem.tables.messages as unknown as Logged[];

describe("a chat turn", () => {
  test("both sides are logged under the owner's number and 'app', with the buttons and the card; nothing goes to WhatsApp", async () => {
    const { chatTurn, chatState } = await import("@/lib/app/chat");
    const out = await chatTurn(restaurantA(), { body: "Thursday is quiet", clientId: "client-0001" });
    expect(out).toEqual({ duplicate: false, replies: 1 });
    expect(logged().map((m) => [m.direction, m.from_number, m.to_number, m.body])).toEqual([
      ["inbound", OWNER, "app", "Thursday is quiet"],
      ["outbound", "app", OWNER, "Here's an *offer* for Thursday"],
    ]);
    expect(logged()[0].twilio_sid).toBe("app-client-0001");
    expect(twilioSends).toEqual([]);

    const state = await chatState(restaurantA());
    const reply = state.messages.at(-1)!;
    expect(reply).toMatchObject({ from: "dinerai", text: "Here's an offer for Thursday", draftId: D, card: { id: D } });
    expect(reply.buttons.map((b) => b.title)).toEqual(["Reply publicly", "Handle privately", "Both"]);
  });

  test("the same message sent twice (a lost connection) is answered once", async () => {
    const { chatTurn } = await import("@/lib/app/chat");
    await chatTurn(restaurantA(), { body: "STATUS", clientId: "client-0002" });
    expect(await chatTurn(restaurantA(), { body: "STATUS", clientId: "client-0002" })).toEqual({ duplicate: true, replies: 0 });
    expect(botCalls).toHaveLength(1);
  });

  test("a tapped quick reply reaches the bot as the button's id, with its title as the words", async () => {
    const { chatTurn } = await import("@/lib/app/chat");
    await chatTurn(restaurantA(), { body: "Reply publicly", payload: `public:${D}` });
    expect(botCalls[0]).toMatchObject({ body: "Reply publicly", buttonPayload: `public:${D}` });
  });

  test("if the bot fails, the owner gets the usual Sorry in the chat and the builder is told", async () => {
    const { SORRY } = await import("@/lib/sorry");
    bot = async () => {
      throw new Error("Claude overloaded");
    };
    const { chatTurn } = await import("@/lib/app/chat");
    expect(await chatTurn(restaurantA(), { body: "hello" })).toMatchObject({ replies: 1 });
    expect(logged().at(-1)).toMatchObject({ direction: "outbound", body: SORRY });
    expect(alerts[0]).toMatch(/App chat failed for Ember & Spice: Claude overloaded/);
  });

  test("a file: an upload link inside the restaurant's own folder, then the bot gets it as media", async () => {
    const { prepareUpload, fileTurn, UploadRefused } = await import("@/lib/app/chat");
    const up = await prepareUpload(restaurantA(), { name: "IMG_0042.jpg", contentType: "image/jpeg", size: 800_000 });
    expect(up.path.startsWith(`${A}/`)).toBe(true);
    expect(up.uploadUrl).toContain("token=u");
    await expect(prepareUpload(restaurantA(), { name: "clip.mov", contentType: "video/quicktime", size: 800 })).rejects.toBeInstanceOf(UploadRefused);

    await fileTurn(restaurantA(), { path: up.path, name: "IMG_0042.jpg", contentType: "image/jpeg" }, "our lamb chops", "client-0003");
    expect(botCalls[0]).toMatchObject({ body: "our lamb chops", media: { contentType: "image/jpeg", url: expect.stringContaining(up.path) } });
    expect(logged()[0]).toMatchObject({ body: "[📷 photo] our lamb chops", app: { file: { path: up.path, contentType: "image/jpeg" } } });

    // Another restaurant's file is never read.
    await expect(fileTurn(restaurantA(), { path: `${B}/2026-11-11/x.jpg`, name: "x.jpg", contentType: "image/jpeg" }, "", null)).rejects.toBeInstanceOf(UploadRefused);
    expect(botCalls).toHaveLength(1);
  });

  test("Answer in Chat: the question goes on screen with its buttons; another restaurant's is refused", async () => {
    const { focusQuestion } = await import("@/lib/app/chat");
    expect(await focusQuestion(restaurantA(), D)).toEqual({ ok: true });
    expect(mem.tables.drafts[0]).toMatchObject({ waiting_for: "decision" });
    expect(logged().at(-1)).toMatchObject({ direction: "outbound", body: expect.stringMatching(/got ill/), app: { draftId: D } });
    expect((logged().at(-1)!.app!.buttons as { id: string }[]).map((b) => b.id)).toEqual([`public:${D}`, `private:${D}`, `both:${D}`]);
    expect(await focusQuestion(mem.tables.restaurants[1] as never, D)).toEqual({ ok: false, error: "not_found" });
  });

  test("app messages never open WhatsApp's 24-hour window", async () => {
    const { chatTurn } = await import("@/lib/app/chat");
    await chatTurn(restaurantA(), { body: "hi" });
    const { canMessageFreely } = await import("@/lib/brief");
    expect(await canMessageFreely(restaurantA(), new Date())).toBe(false);
  });
});

// ---------- The real bot, answering into the app ----------

describe("the real bot in the app", () => {
  test("HELP is answered into the chat, never to WhatsApp", async () => {
    vi.doUnmock("@/lib/bot");
    const restaurant = { ...(restaurantA() as object), id: A, paused: false, brief_waiting_since: null, is_demo: true };
    vi.doMock("@/lib/assistant", async (orig) => ({ ...(await orig<object>()), loadRestaurantContext: async () => ({ restaurantId: A, restaurant, now: new Date("2026-11-11T12:00:00Z") }) }));
    vi.doMock("@/lib/outbox", () => ({ deliverOutbox: async () => 0 }));
    vi.doMock("@/lib/followups", async (orig) => ({ ...(await orig<object>()), releaseQueue: async () => {} }));
    vi.doMock("@/lib/review/deliver", () => ({ deliverWaitingReview: async () => false }));
    vi.doMock("@/lib/review/flow-run", () => ({ handleReviewFlow: async () => false }));
    const { chatTurn, chatState } = await import("@/lib/app/chat");
    const out = await chatTurn(restaurantA(), { body: "HELP" });
    expect(out.replies).toBeGreaterThan(0);
    expect(twilioSends).toEqual([]);
    const state = await chatState(restaurantA());
    expect(state.messages[0]).toMatchObject({ from: "owner", text: "HELP", channel: "app" });
    expect(state.messages.slice(1).map((m) => m.text).join("\n")).toMatch(/APPROVE|UNDO|PAUSE/);
  });
});

// ---------- The routes ----------

describe("chat routes", () => {
  const token = "access-token-123456";
  beforeEach(() => {
    vi.doMock("@/lib/auth", async (orig) => ({
      ...(await orig<object>()),
      ownerFromToken: async (t: string) => (t === token ? { email: "sam@ember.test", isBuilder: false, restaurantIds: [A], allowed: true } : null),
    }));
  });
  const req = (url: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) =>
    new NextRequest(url, {
      method: init.method ?? "GET",
      body: init.body ? JSON.stringify(init.body) : undefined,
      headers: { "content-type": "application/json", ...(init.auth === false ? {} : { authorization: `Bearer ${token}` }) },
    });

  test("no login, no chat", async () => {
    const { GET, POST } = await import("@/app/api/app/chat/route");
    expect((await GET(req("https://app.test/api/app/chat", { auth: false }))).status).toBe(401);
    expect((await POST(req("https://app.test/api/app/chat", { method: "POST", body: { text: "hi" }, auth: false }))).status).toBe(401);
  });

  test("asking for another restaurant gets the owner's own; an empty message is refused", async () => {
    const { POST } = await import("@/app/api/app/chat/route");
    const res = await POST(req(`https://app.test/api/app/chat?r=${B}`, { method: "POST", body: { text: "hi", clientId: "client-0009" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.restaurantId).toBe(A);
    expect(logged().every((m) => m.restaurant_id === A)).toBe(true);
    expect((await POST(req("https://app.test/api/app/chat", { method: "POST", body: { text: "  " } }))).status).toBe(400);
  });

  test("a refused file is said in plain words, and the bot isn't asked", async () => {
    const upload = await import("@/app/api/app/chat/upload/route");
    const res = await upload.POST(req("https://app.test/api/app/chat/upload", { method: "POST", body: { name: "IMG.HEIC", contentType: "image/heic", size: 1000 } }));
    expect(await res.json()).toEqual({ refused: expect.stringMatching(/HEIC/) });
    const { POST } = await import("@/app/api/app/chat/route");
    const sent = await (await POST(req("https://app.test/api/app/chat", { method: "POST", body: { file: { path: `${B}/x/y.jpg`, name: "y.jpg", contentType: "image/jpeg" } } }))).json();
    expect(sent.refused).toMatch(/isn't one of yours/);
    expect(botCalls).toEqual([]);
  });

  test("Answer in Chat needs a draft id of the owner's restaurant", async () => {
    const { POST } = await import("@/app/api/app/chat/focus/route");
    expect((await POST(req("https://app.test/api/app/chat/focus", { method: "POST", body: { draftId: "nope" } }))).status).toBe(400);
    const ok = await POST(req("https://app.test/api/app/chat/focus", { method: "POST", body: { draftId: D } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).messages.at(-1)).toMatchObject({ draftId: D, card: { id: D } });
  });
});
