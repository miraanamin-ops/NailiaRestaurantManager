// The web chat with Dina, server side: what the chat draws from what's saved
// (lib/onboarding/dina/view.ts), the stream reader, and the endpoint
// (app/api/onboarding/chat/route.ts): who may use it, the rate limit, what each
// tap means, and the events it streams.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readEvents, type ChatEvent } from "@/components/chat/stream";
import { complete, skip, wait } from "@/lib/onboarding/flow";
import { basicsCard, chatFrom, confirmText, progressFrom, skippableNow, summaryFrom, type StoredMessage } from "@/lib/onboarding/dina/view";
import { memoryDb } from "./support/memory-db";

const T = "2026-10-29T10:00:00.000Z";
const restaurant = { owner_name: "Amina Khan", name: "Ember & Spice Grill", address: "12 High Street, London E1 6AN", cuisine: null };

describe("what the chat draws", () => {
  const row = (id: string, role: StoredMessage["role"], body: string, parts: unknown[] = []): StoredMessage => ({ id, role, body, parts });

  test("the basics card comes from the saved details (never Dina's words), with the role from Hello", () => {
    const state = complete({}, "hello", "done", { role: "manager" }, T);
    expect(basicsCard({ restaurant, state }).fields.map((f) => [f.label, f.value])).toEqual([
      ["Your name", "Amina Khan"],
      ["Restaurant", "Ember & Spice Grill"],
      ["Address", "12 High Street, London E1 6AN"],
      ["Cuisine", null],
      ["Your role", "Manager"],
    ]);
  });

  test("before Hello is done the card shows what the owner has told Dina (her checked draft); afterwards only what's saved", () => {
    const noted = { draft: { address: "45 Mile End Road, London E1 4TT", cuisine: "Halal grill", role: "owner" } };
    const drafting = { hello: { status: "in_progress" as const, data: noted, waitingOn: null, startedAt: T, completedAt: null, skippedAt: null } };
    expect(basicsCard({ restaurant, state: drafting }).fields.map((f) => f.value)).toEqual(["Amina Khan", "Ember & Spice Grill", "45 Mile End Road, London E1 4TT", "Halal grill", "Owner"]);
    const done = complete(drafting, "hello", "done", { role: "owner" }, T);
    expect(basicsCard({ restaurant: { ...restaurant, cuisine: "Grill" }, state: done }).fields.map((f) => f.value)).toEqual(["Amina Khan", "Ember & Spice Grill", "12 High Street, London E1 6AN", "Grill", "Owner"]);
  });

  test("a question counts as answered once the owner has said anything after it; a tap's choice is remembered", () => {
    const rows = [
      row("d1", "dina", "Do you have a Google profile?", [{ type: "quick_replies", options: [{ id: "yes", label: "Yes" }] }]),
      row("o1", "owner", "Yes", [{ type: "answer", to: "d1", choice: "yes" }]),
      row("d2", "dina", "Check these.", [{ type: "editable_card", card: "basics" }]),
      row("s1", "system", "internal note"),
    ];
    const { messages, chosen } = chatFrom(rows, { restaurant, state: {} });
    expect(messages.map((m) => [m.id, m.role, m.answered])).toEqual([
      ["d1", "dina", true],
      ["o1", "owner", false],
      ["d2", "dina", false],
    ]);
    expect(chosen).toEqual({ d1: "yes" });
    expect(messages[2].component).toMatchObject({ type: "confirmation", card: { title: "Your basics" } });
  });

  test("a card for a step that isn't built yet, or an unknown part, shows no component", () => {
    const { messages } = chatFrom([row("d1", "dina", "Your hours.", [{ type: "editable_card", card: "hours" }]), row("d2", "dina", "Hi.", [{ type: "nonsense" }])], { restaurant, state: {} });
    expect(messages.map((m) => m.component)).toEqual([null, null]);
  });

  test("the step list: the focus is 'now' (even a skipped step being done again), a step waiting on Google is 'waiting'", () => {
    let state = complete({}, "hello", "done", {}, T);
    state = wait(state, "google", "google_acceptance", {}, T);
    state = skip(state, "tone", T);
    const p = progressFrom(state, "make_it_right");
    expect(p).toMatchObject({ position: 4, total: 6 });
    expect(p.steps.map((s) => s.status)).toEqual(["done", "waiting", "skipped", "in_progress", "not_started", "not_started"]);
    // Editing a finished step: it stays done in the list.
    expect(progressFrom(state, "hello").steps[0].status).toBe("done");
  });

  test("'Skip for now' only on a skippable step that's part of setup", () => {
    expect(skippableNow("hello")).toBe(false);
    expect(skippableNow("tone")).toBe(true);
    expect(skippableNow("sales")).toBe(false); // not built yet
    expect(skippableNow(null)).toBe(false);
  });

  test("the summary: what's done, what's half done, what's locked and what it unlocks", () => {
    let state = complete({}, "hello", "done", {}, T);
    state = skip(state, "google", T);
    state = complete(state, "tone", "partial", {}, T);
    const s = summaryFrom({ restaurant: { ...restaurant, cuisine: "Halal grill" }, state });
    expect(s).toMatchObject({ done: 1, total: 6 });
    expect(s.items.map((i) => [i.title, i.status, i.detail])).toEqual([
      ["Hello", "done", "Ember & Spice Grill, Halal grill, 12 High Street, London E1 6AN"],
      ["Your tone", "partial", "Half done"],
    ]);
    expect(s.locked.map((l) => l.key)).toEqual(["google", "tone"]);
  });

  test("a confirmation card's changes become the owner's words for Dina", () => {
    const card = basicsCard({ restaurant, state: {} });
    expect(confirmText(card, {})).toBe("Looks right");
    expect(confirmText(card, { cuisine: "Halal grill", address: "" })).toBe("Please change these: Cuisine: Halal grill; Address: (blank)");
  });
});

describe("reading the stream", () => {
  test("events arrive as each line completes, even split across chunks; a broken line is skipped", async () => {
    const enc = new TextEncoder();
    const chunks = ['{"type":"typing"}\n{"type":"sta', 'tus","text":"Saving your basics…"}\nnot json\n', '{"type":"done"}'];
    const body = new ReadableStream<Uint8Array>({ start: (c) => (chunks.forEach((x) => c.enqueue(enc.encode(x))), c.close()) });
    const events: ChatEvent[] = [];
    await readEvents(body, (e) => events.push(e));
    expect(events).toEqual([{ type: "typing" }, { type: "status", text: "Saving your basics…" }, { type: "done" }]);
  });
});

// ---------- The endpoint ----------

const R = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OTHER = "bbbbbbbb-0000-4000-8000-0000000000b1";
const uuid = () => crypto.randomUUID();
let db: ReturnType<typeof memoryDb>;
let owner: { email: string; isBuilder: boolean; restaurantIds: string[]; allowed: boolean } | null;
let limited = false;
const dinaTurn = vi.fn();

beforeEach(() => {
  vi.resetModules();
  db = memoryDb({
    restaurants: [{ id: R, name: "Ember & Spice Grill", owner_name: "Amina Khan", address: null, cuisine: null }],
    onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "tone", started_at: T, completed_at: null }],
    onboarding_steps: [{ restaurant_id: R, step_key: "hello", status: "done", data: {}, waiting_on: null, started_at: T, completed_at: T, skipped_at: null }],
    onboarding_messages: [],
    setup_gaps: [],
  });
  owner = { email: "amina@grill.test", isBuilder: false, restaurantIds: [R], allowed: true };
  limited = false;
  dinaTurn.mockReset();
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/auth", () => ({ currentOwner: async () => owner }));
  vi.doMock("@/lib/rate-limit", async (orig) => ({ ...(await orig<object>()), overLimit: async () => limited }));
  vi.doMock("@/lib/onboarding/dina/turn", () => ({ dinaTurn }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/auth", "@/lib/rate-limit", "@/lib/onboarding/dina/turn"]) vi.doUnmock(m);
});

async function call(body: object) {
  const { POST } = await import("@/app/api/onboarding/chat/route");
  const res = await POST(new Request("https://app.test/api/onboarding/chat", { method: "POST", body: JSON.stringify(body) }));
  const events: ChatEvent[] = [];
  if (res.ok && res.body) await readEvents(res.body, (e) => events.push(e));
  return { status: res.status, events };
}

const reply = (texts: string[]) => {
  dinaTurn.mockImplementation(async (input: { onStatus?: (t: string) => void }) => {
    input.onStatus?.("Saving your basics…");
    return { duplicate: false, fallback: false, toolCalls: [], costUsd: 0.01, step: "tone", reply: { messages: [] }, messages: texts.map((text) => ({ id: uuid(), text, component: null })) };
  });
};

describe("the chat endpoint", () => {
  test("not logged in, someone else's restaurant, or a malformed request: refused, and Dina isn't called", async () => {
    const message = { kind: "message", text: "hi", clientId: uuid() };
    owner = null;
    expect((await call({ r: R, action: message })).status).toBe(401);
    owner = { email: "x", isBuilder: false, restaurantIds: [OTHER], allowed: true };
    expect((await call({ r: R, action: message })).status).toBe(403);
    owner = { email: "x", isBuilder: false, restaurantIds: [R], allowed: true };
    expect((await call({ r: R, action: { kind: "message", text: "" } })).status).toBe(400);
    expect(dinaTurn).not.toHaveBeenCalled();
  });

  test("too many turns in a short time: 429, and Dina isn't called", async () => {
    limited = true;
    expect((await call({ r: R, action: { kind: "message", text: "hi", clientId: uuid() } })).status).toBe(429);
    expect(dinaTurn).not.toHaveBeenCalled();
  });

  test("a message streams: typing, what she's doing, each checked message in order, the new state, done", async () => {
    reply(["Lovely, saved.", "Next, your tone."]);
    const clientId = uuid();
    const { status, events } = await call({ r: R, action: { kind: "message", text: "We're a halal grill", clientId } });
    expect(status).toBe(200);
    expect(events.map((e) => e.type)).toEqual(["typing", "status", "message", "message", "state", "done"]);
    expect(events.filter((e) => e.type === "message").map((e) => (e as { message: { text: string } }).message.text)).toEqual(["Lovely, saved.", "Next, your tone."]);
    expect(events.find((e) => e.type === "state")).toMatchObject({ skippable: true, progress: { position: 3, total: 6 } });
    expect(dinaTurn).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: R, channel: "web", event: "message", text: "We're a halal grill", externalId: clientId }));
  });

  test("a tap on a button is the owner's answer, remembered against the message it answered", async () => {
    reply(["Great."]);
    const messageId = uuid();
    await call({ r: R, action: { kind: "answer", messageId, choiceId: "yes", label: "Yes", clientId: uuid() } });
    expect(dinaTurn).toHaveBeenCalledWith(expect.objectContaining({ text: "Yes", ownerParts: [{ type: "answer", to: messageId, choice: "yes" }] }));
  });

  test("'Skip for now' is done by code first, then Dina is told", async () => {
    reply(["No problem, we can do this later."]);
    await call({ r: R, action: { kind: "skip", clientId: uuid() } });
    expect(db.tables.onboarding_steps.find((s) => s.step_key === "tone")?.status).toBe("skipped");
    expect(db.tables.setup_gaps.map((g) => g.step_key)).toEqual(["tone"]);
    expect(dinaTurn).toHaveBeenCalledWith(expect.objectContaining({ event: "action", text: "Skip for now", note: expect.stringMatching(/Skip for now.*Your tone.*skipped/) }));
  });

  test("picking a step from the list moves there first; a step that isn't built is refused with a message", async () => {
    reply(["Let's do it."]);
    await call({ r: R, action: { kind: "jump", step: "menu", clientId: uuid() } });
    expect(db.tables.onboarding_sessions[0].current_step).toBe("menu");
    expect(dinaTurn).toHaveBeenCalledWith(expect.objectContaining({ event: "action", note: expect.stringMatching(/Your menu/) }));
    dinaTurn.mockClear();
    const { events } = await call({ r: R, action: { kind: "jump", step: "sales", clientId: uuid() } });
    expect(events.at(-1)).toEqual({ type: "error", text: expect.stringMatching(/isn't part of setup yet/) });
    expect(dinaTurn).not.toHaveBeenCalled();
  });

  test("'start' only says hello the very first time", async () => {
    reply(["Hi, I'm Dina."]);
    expect((await call({ r: R, action: { kind: "start" } })).events.map((e) => e.type)).toEqual(["typing", "status", "message", "state", "done"]);
    db.tables.onboarding_messages.push({ id: uuid(), restaurant_id: R, role: "dina", body: "Hi" });
    dinaTurn.mockClear();
    expect((await call({ r: R, action: { kind: "start" } })).events.map((e) => e.type)).toEqual(["typing", "done"]);
    expect(dinaTurn).not.toHaveBeenCalled();
  });

  test("a repeated send is answered once; a crash becomes an error the owner can retry", async () => {
    dinaTurn.mockResolvedValueOnce({ duplicate: true });
    expect((await call({ r: R, action: { kind: "message", text: "hi", clientId: uuid() } })).events.map((e) => e.type)).toEqual(["typing", "done"]);
    dinaTurn.mockRejectedValueOnce(new Error("database down"));
    const { events } = await call({ r: R, action: { kind: "message", text: "hi", clientId: uuid() } });
    expect(events.at(-1)).toEqual({ type: "error", text: expect.stringMatching(/Please try again/) });
  });

  test("the builder can use it for any restaurant they can see", async () => {
    reply(["Hi."]);
    owner = { email: "builder@dinerai.test", isBuilder: true, restaurantIds: [R, OTHER], allowed: true };
    expect((await call({ r: R, action: { kind: "message", text: "hello", clientId: uuid() } })).status).toBe(200);
  });
});

