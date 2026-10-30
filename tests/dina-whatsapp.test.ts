// Dina on WhatsApp (phase 5): her messages drawn as WhatsApp buttons, lists and
// numbered text (src/lib/onboarding/dina/whatsapp.ts), replies read back (a tap,
// a number, the option's words, "skip"), the files owners can send (uploads.ts),
// and whole turns on the in-memory database (whatsapp-turn.ts): switching from
// the web chat mid-step, a repeat delivery answered once, files saved privately
// and answered once per burst, refused files explained, and the hello after
// linking. Claude and Twilio are stand-ins.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ChatMessage } from "@/components/chat/types";
import { describeFiles, refusedText, uploadKind } from "@/lib/onboarding/dina/uploads";
import { payloadFor, readWhatsAppReply, renderForWhatsApp, WA } from "@/lib/onboarding/dina/whatsapp";
import { memoryDb } from "./support/memory-db";

const M1 = "11111111-1111-4111-8111-111111111111";
const opts = { skippable: false, chatUrl: "https://app.test/onboarding/chat?r=x" };
const dina = (text: string, component: ChatMessage["component"] = null, id = M1): ChatMessage => ({ id, role: "dina", text, component });
const quick = (...labels: string[]) => ({ type: "quick_replies" as const, options: labels.map((label, i) => ({ id: `o${i + 1}`, label })) });

describe("drawing Dina's messages for WhatsApp", () => {
  test("plain words are one text message each", () => {
    expect(renderForWhatsApp([dina("Hi Amina."), dina("Shall we start?")], opts)).toEqual([
      { kind: "text", body: "Hi Amina." },
      { kind: "text", body: "Shall we start?" },
    ]);
  });

  test("up to 3 short choices are buttons, carrying the message id, with 'Reply 1, 2 or 3' as well", () => {
    const [out] = renderForWhatsApp([dina("Are you the owner?", quick("Owner", "Manager"))], opts);
    expect(out).toEqual({
      kind: "buttons",
      body: "Are you the owner?\n\nReply 1 or 2",
      options: [
        { id: `dina:${M1}:o1`, title: "Owner", description: "Or reply 1" },
        { id: `dina:${M1}:o2`, title: "Manager", description: "Or reply 2" },
      ],
    });
  });

  test("on a skippable step the last question also offers 'Skip for now' (a third button)", () => {
    const [out] = renderForWhatsApp([dina("Do you have a Google profile?", quick("Yes", "No"))], { ...opts, skippable: true });
    expect(out).toMatchObject({ kind: "buttons", body: expect.stringMatching(/Reply 1, 2 or 3$/) });
    expect(out.kind !== "text" && out.options.map((o) => [o.title, o.id])).toEqual([
      ["Yes", `dina:${M1}:o1`],
      ["No", `dina:${M1}:o2`],
      ["Skip for now", `dina:${M1}:skip`],
    ]);
  });

  test("more than 3 choices, or a label too long for a button, become a list with the numbers in the text", () => {
    const [four] = renderForWhatsApp([dina("Which days are you closed?", quick("Monday", "Tuesday", "Sunday", "None"))], opts);
    expect(four).toMatchObject({ kind: "list", button: "See the options" });
    expect(four.body).toBe("Which days are you closed?\n\n*1* Monday\n*2* Tuesday\n*3* Sunday\n*4* None\n\nReply with a number, or tap *See the options*.");
    // "The general manager" (19) still fits on a button; 21 characters doesn't.
    expect(renderForWhatsApp([dina("Who?", quick("Me", "The general manager"))], opts)[0].kind).toBe("buttons");
    const [tooLong] = renderForWhatsApp([dina("Pick one.", quick("Yes", "Someone else handles it"))], opts);
    expect(tooLong.kind).toBe("list");
    expect(tooLong.kind !== "text" && tooLong.options.every((o) => o.title.length <= WA.rowTitle && o.description.length <= WA.rowDescription)).toBe(true);
  });

  test("choice cards: one card per message (never a wall of text), then the choice", () => {
    const cards = {
      type: "choice_cards" as const,
      cards: [
        { id: "warm", title: "Warm and personal", body: "Sarah, thank you so much!" },
        { id: "polished", title: "Polished and professional", body: "Dear Sarah, thank you." },
        { id: "fun", title: "Fun and chatty", body: "Best mixed grill in ages? We'll take that!" },
        { id: "short", title: "Short and simple", body: "Thanks Sarah!" },
      ],
    };
    const out = renderForWhatsApp([dina("Here's a typical review. Which reply sounds like you?", cards)], { ...opts, skippable: true });
    expect(out.map((o) => o.kind)).toEqual(["text", "text", "text", "text", "text", "list"]);
    expect(out[1].body).toBe("*1. Warm and personal*\nSarah, thank you so much!");
    const pick = out[5];
    expect(pick.kind === "list" && pick.options.map((o) => o.id)).toEqual(["warm", "polished", "fun", "short", "skip"].map((id) => payloadFor(M1, id)));
    expect(pick.kind === "list" && pick.options[0].description).toBe("Sarah, thank you so much!");
  });

  test("a confirmation card: its rows as text (from the database), then Looks right / Change something", () => {
    const card = {
      type: "confirmation" as const,
      card: { title: "Your basics", fields: [{ key: "name", label: "Restaurant", value: "Ember Grill" }, { key: "address", label: "Address", value: null }] },
    };
    const [out] = renderForWhatsApp([dina("Is this right?", card)], { ...opts, skippable: true });
    expect(out).toMatchObject({ kind: "buttons", body: "Is this right?\n\n*Your basics*\nRestaurant: Ember Grill\nAddress: not given yet\n\nReply 1 or 2" });
    expect(out.kind !== "text" && out.options.map((o) => o.title)).toEqual(["Looks right", "Change something"]);
  });

  test("an upload says how to send it; the summary links to the web; a skippable step without choices says SKIP", () => {
    const [up] = renderForWhatsApp([dina("Send me your menu.", { type: "upload", accept: "document", multiple: true, label: "Upload menu" })], { ...opts, skippable: true });
    expect(up.body).toBe("Send me your menu.\n\nSend me the PDF here, or a photo of each page.\n\nOr reply *SKIP* to leave this for now.");
    const summary = { type: "summary" as const, summary: { done: 1, total: 6, items: [{ key: "hello", title: "Hello", status: "done" as const, detail: "Ember Grill" }], locked: [{ key: "menu", title: "Menu", unlock: "Share your menu." }], next: [] } };
    expect(renderForWhatsApp([dina("All done for now.", summary)], opts)[0].body).toMatch(/Setup 1 of 6 done\.\n✅ Hello: Ember Grill\n\nFor later:\n• Menu: Share your menu\.\n\nEverything is here too: https:\/\/app\.test/);
  });

  test("with no choices, 'reply SKIP' goes only under a question, not after every line", () => {
    const skippable = { ...opts, skippable: true };
    expect(renderForWhatsApp([dina("Got it, thanks."), dina("What are your Sunday hours?")], skippable).map((o) => o.body)).toEqual([
      "Got it, thanks.",
      "What are your Sunday hours?\n\nOr reply *SKIP* to leave this for now.",
    ]);
    expect(renderForWhatsApp([dina("Got it, thanks.")], skippable)[0].body).toBe("Got it, thanks.");
  });

  test("bodies stay within WhatsApp's limits", () => {
    const [b] = renderForWhatsApp([dina("x".repeat(1500), quick("Yes", "No"))], opts);
    expect(b.body.length).toBeLessThanOrEqual(WA.interactiveBody);
    expect(b.body).toMatch(/…\n\nReply 1 or 2$/);
    const [t] = renderForWhatsApp([dina("y".repeat(2000))], opts);
    expect(t.body.length).toBeLessThanOrEqual(WA.text);
  });
});

describe("reading the owner's WhatsApp replies", () => {
  const asking = { messageId: M1, component: quick("Owner", "Manager") };

  test("a button tap or list pick answers the message it came from", () => {
    expect(readWhatsAppReply({ body: "Manager", buttonPayload: payloadFor(M1, "o2") }, asking, false)).toEqual({ kind: "answer", messageId: M1, choiceId: "o2", label: "Manager" });
    expect(readWhatsAppReply({ body: "Owner", listId: payloadFor(M1, "o1") }, null, false)).toEqual({ kind: "answer", messageId: M1, choiceId: "o1", label: "Owner" });
  });

  test("a typed number or the option's own words work too", () => {
    expect(readWhatsAppReply({ body: "2" }, asking, false)).toMatchObject({ kind: "answer", choiceId: "o2", label: "Manager" });
    expect(readWhatsAppReply({ body: " manager! " }, asking, false)).toMatchObject({ kind: "answer", choiceId: "o2" });
    expect(readWhatsAppReply({ body: "*1*" }, asking, false)).toMatchObject({ kind: "answer", choiceId: "o1" });
  });

  test("skip: the word, the number after the choices, or the button, on a skippable step only", () => {
    expect(readWhatsAppReply({ body: "skip" }, asking, true)).toEqual({ kind: "skip" });
    expect(readWhatsAppReply({ body: "Skip for now" }, null, true)).toEqual({ kind: "skip" });
    expect(readWhatsAppReply({ body: "3" }, asking, true)).toEqual({ kind: "skip" });
    expect(readWhatsAppReply({ body: "x", buttonPayload: payloadFor(M1, "skip") }, asking, true)).toEqual({ kind: "skip" });
    expect(readWhatsAppReply({ body: "skip" }, asking, false)).toEqual({ kind: "text", text: "skip" }); // Hello can't be skipped
    expect(readWhatsAppReply({ body: "3" }, asking, false)).toEqual({ kind: "text", text: "3" });
  });

  test("a card's buttons: Looks right confirms; Change something is an answer", () => {
    const card = { messageId: M1, component: { type: "confirmation" as const, card: { title: "Your basics", fields: [] } } };
    expect(readWhatsAppReply({ body: "1" }, card, true)).toEqual({ kind: "confirm", messageId: M1 });
    expect(readWhatsAppReply({ body: "Change something", buttonPayload: payloadFor(M1, "change") }, card, true)).toMatchObject({ kind: "answer", choiceId: "change" });
  });

  test("anything else is the owner's own words", () => {
    expect(readWhatsAppReply({ body: "We're actually a café now" }, asking, false)).toEqual({ kind: "text", text: "We're actually a café now" });
    expect(readWhatsAppReply({ body: "1" }, null, false)).toEqual({ kind: "text", text: "1" });
  });
});

describe("files owners send", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...Array(16).fill(0x20)]);
  test("photos, PDFs, CSV and Excel are known by their first bytes, not just their label", () => {
    expect(uploadKind("image/jpeg", bytes(0xff, 0xd8, 0xff))).toMatchObject({ kind: "photo", ext: "jpg" });
    expect(uploadKind("application/octet-stream", bytes(0x89, 0x50, 0x4e, 0x47))).toMatchObject({ kind: "photo", ext: "png" });
    expect(uploadKind("application/pdf", bytes(0x25, 0x50, 0x44, 0x46))).toMatchObject({ kind: "pdf" });
    expect(uploadKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes(0x50, 0x4b, 0x03, 0x04))).toMatchObject({ kind: "excel", ext: "xlsx" });
    expect(uploadKind("application/vnd.ms-excel", bytes(0xd0, 0xcf, 0x11, 0xe0))).toMatchObject({ kind: "excel", ext: "xls" });
    expect(uploadKind("text/csv", new TextEncoder().encode("date,sales\n2026-10-01,1200\n"))).toMatchObject({ kind: "csv" });
    expect(uploadKind("text/comma-separated-values", new TextEncoder().encode("a;b\n1;2"))).toMatchObject({ kind: "csv" });
  });

  test("anything else is refused: a Word file, a video, a 'PDF' that isn't, text that isn't a table", () => {
    expect(uploadKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(uploadKind("video/mp4", bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70))).toBeNull();
    expect(uploadKind("application/pdf", new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(uploadKind("text/plain", new TextEncoder().encode("just a note"))).toBeNull();
    expect(uploadKind("text/csv", new Uint8Array([0x61, 0x2c, 0x00, 0x62]))).toBeNull();
  });

  test("what the owner hears", () => {
    expect(describeFiles([{ kind: "photo" }, { kind: "photo" }, { kind: "pdf" }])).toBe("2 photos and a PDF");
    expect(describeFiles([{ kind: "excel" }])).toBe("an Excel file");
    expect(refusedText([{ reason: "type", label: "video/mp4" }])).toBe("I can't open that kind of file. I can take photos, PDFs, and CSV or Excel files. Could you send it as one of those?");
    expect(refusedText([{ reason: "size", label: "application/pdf" }])).toMatch(/too big for me \(the most is 16 MB\)/);
    expect(refusedText([])).toBeNull();
  });
});

// ---------- Whole turns, on the in-memory database ----------

const R = "dddddddd-0000-4000-8000-0000000000e1";
const OWNER = "whatsapp:+447700900123";
const OURS = "whatsapp:+14155238886";
let db: ReturnType<typeof memoryDb>;
const sent: { kind: string; body: string; options?: { id: string; title: string }[] }[] = [];
const callDina = vi.fn();
const usage = { purpose: "turn", model: "claude-sonnet-5-5", tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.003 } };
const answer = (...messages: { text: string; component?: unknown }[]) => ({ reply: { messages: messages.map((m) => ({ component: null, ...m })) }, calls: [usage], toolCalls: [], attempts: 1 });
const tick = () => new Promise((r) => setTimeout(r, 3));

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
  callDina.mockReset();
  process.env.DINA_FILE_BURST_MS = "0";
  process.env.DINA_MESSAGE_GAP_MS = "0";
  db = memoryDb(
    {
      restaurants: [{ id: R, name: "Ember Grill", owner_name: "Amina Khan", owner_whatsapp: OWNER, active: false, address: null, cuisine: null, menu: [], profile_version: 0 }],
      onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "hello", channel_last_used: "web", started_at: "2026-10-30T10:00:00.000Z", completed_at: null }],
      onboarding_steps: [],
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      messages: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "sent" }));
  vi.doMock("@/lib/onboarding/dina/call", async (orig) => ({ ...(await orig<object>()), callDina, routeStep: async () => ({ step: null, call: usage }) }));
  vi.doMock("@/lib/whatsapp", () => ({
    sendText: async (_f: string, _t: string, body: string) => (sent.push({ kind: "text", body }), { sid: `SMout${sent.length}`, body }),
    sendDinaChoices: async (_f: string, _t: string, m: { kind: string; body: string; options: { id: string; title: string }[] }) => (
      sent.push({ kind: m.kind, body: m.body, options: m.options }), { sid: `SMout${sent.length}`, body: m.body, usedButtons: true }
    ),
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/onboarding/dina/call", "@/lib/whatsapp"]) vi.doUnmock(m);
  vi.unstubAllGlobals();
});

const whatsapp = async (body: string, extra: Record<string, unknown> = {}) => {
  const { handleDinaWhatsApp } = await import("@/lib/onboarding/dina/whatsapp-turn");
  await handleDinaWhatsApp({ restaurantId: R, owner: OWNER, sandbox: OURS, body, media: [], messageSid: `SM${Math.random().toString(36).slice(2)}`, ...extra });
  await tick();
};
const ownerRows = () => db.tables.onboarding_messages.filter((m) => m.role === "owner");

describe("Dina on WhatsApp, whole turns", () => {
  test("only a restaurant setting up with Dina is routed to her", async () => {
    const { dinaSetupInProgress } = await import("@/lib/onboarding/dina/whatsapp-turn");
    expect(await dinaSetupInProgress(R)).toBe(true);
    db.tables.restaurants[0].active = true; // a running restaurant, even with a session row
    expect(await dinaSetupInProgress(R)).toBe(false);
    db.tables.restaurants[0].active = false;
    db.tables.onboarding_sessions[0].completed_at = "2026-10-30T12:00:00.000Z";
    expect(await dinaSetupInProgress(R)).toBe(false);
    db.tables.onboarding_sessions.length = 0;
    expect(await dinaSetupInProgress(R)).toBe(false);
  });

  test("the queue's worker hands a Dina sign-up's message to Dina, not the older setup or the assistant", async () => {
    const oldFlow = vi.fn();
    const assistant = vi.fn();
    vi.doMock("@/lib/onboarding/whatsapp-flow", () => ({ onboardingInProgress: async () => true, handleOnboardingMessage: oldFlow }));
    vi.doMock("@/lib/bot", () => ({ handleMessage: assistant }));
    callDina.mockResolvedValueOnce(answer({ text: "Lovely." }));
    const { HANDLERS } = await import("@/lib/queue/handlers");
    const job = { restaurant_id: R, payload: { kind: "owner", owner: OWNER, sandbox: OURS, body: "we're a halal grill", messageSid: "SMq9", media: [] } };
    expect(await HANDLERS.owner_message.run(job as never)).toEqual({ handled: "dina" });
    expect(oldFlow).not.toHaveBeenCalled();
    expect(assistant).not.toHaveBeenCalled();
    expect(ownerRows()).toEqual([expect.objectContaining({ body: "we're a halal grill", external_id: "SMq9" })]);
    vi.doUnmock("@/lib/onboarding/whatsapp-flow");
    vi.doUnmock("@/lib/bot");
  });

  test("started on the web, carried on on WhatsApp at the exact step: '2' answers the web question, and Dina knows they switched", async () => {
    // On the web: Dina asked a question with buttons.
    callDina.mockResolvedValueOnce(answer({ text: "Hi Amina, I'm Dina, your DinerAI manager." }, { text: "Are you the owner or the manager?", component: quick("Owner", "Manager") }));
    const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
    await dinaTurn({ restaurantId: R, channel: "web", event: "start" });
    await tick();
    const webQuestion = db.tables.onboarding_messages.at(-1)!;

    // On WhatsApp: the owner types "2".
    callDina.mockResolvedValueOnce(answer({ text: "Thanks. Next, your restaurant's address?" }));
    await whatsapp("2");
    const turn = callDina.mock.calls[1][0];
    expect(turn.step).toBe("hello");
    expect(turn.content).toMatch(/The step you're on: hello/);
    expect(turn.content).toMatch(/<owner_message>\nManager\n<\/owner_message>/);
    expect(turn.content).toMatch(/switched from the web chat to WhatsApp/);
    expect(ownerRows()).toEqual([expect.objectContaining({ channel: "whatsapp", body: "Manager", parts: [{ type: "answer", to: webQuestion.id, choice: "o2" }] })]);
    expect(sent).toEqual([{ kind: "text", body: "Thanks. Next, your restaurant's address?" }]);
    // Both channels show one conversation.
    expect(db.tables.onboarding_messages.map((m) => [m.role, m.channel])).toEqual([
      ["dina", "web"],
      ["dina", "web"],
      ["owner", "whatsapp"],
      ["dina", "whatsapp"],
    ]);
  });

  test("Dina's choices go out as buttons whose taps come back to the right message", async () => {
    callDina.mockResolvedValueOnce(answer({ text: "Are you the owner or the manager?", component: quick("Owner", "Manager") }));
    await whatsapp("hello there");
    const question = db.tables.onboarding_messages.at(-1)!;
    expect(sent[0]).toMatchObject({ kind: "buttons", body: "Are you the owner or the manager?\n\nReply 1 or 2", options: [{ id: `dina:${question.id}:o1`, title: "Owner" }, { id: `dina:${question.id}:o2` }] });

    callDina.mockResolvedValueOnce(answer({ text: "Lovely." }));
    await whatsapp("Owner", { buttonPayload: `dina:${question.id}:o1` });
    expect(ownerRows().at(-1)).toMatchObject({ body: "Owner", parts: [{ type: "answer", to: question.id, choice: "o1" }] });
  });

  test("Twilio delivering the same message twice: saved once, answered once", async () => {
    callDina.mockResolvedValue(answer({ text: "Lovely." }));
    await whatsapp("we're a halal grill", { messageSid: "SMsame" });
    await whatsapp("we're a halal grill", { messageSid: "SMsame" });
    expect(callDina).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  test("'skip' on a skippable step: code skips it (a setup gap), then Dina carries on", async () => {
    db.tables.onboarding_sessions[0].current_step = "google";
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "hello", status: "done", data: {}, completed_at: "2026-10-30T10:05:00.000Z" });
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "google", status: "in_progress", data: {}, started_at: "2026-10-30T10:05:00.000Z" });
    callDina.mockResolvedValueOnce(answer({ text: "No problem, we can do this later. Next, your tone." }));
    await whatsapp("skip");
    expect(db.tables.onboarding_steps.find((s) => s.step_key === "google")?.status).toBe("skipped");
    expect(db.tables.setup_gaps).toEqual([expect.objectContaining({ step_key: "google" })]);
    expect(callDina.mock.calls[0][0].content).toMatch(/chose "Skip for now" on Google profile/);
  });

  test("a menu photo: saved in the private bucket with the message, and Dina says she has it", async () => {
    db.tables.onboarding_sessions[0].current_step = "menu";
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
    callDina.mockResolvedValueOnce(answer({ text: "Got your menu photo, thanks." }));
    await whatsapp("", { messageSid: "SMphoto1", media: [{ url: "https://api.twilio.com/m/1", contentType: "image/jpeg" }] });
    expect([...db.files.keys()]).toEqual([`onboarding-uploads/${R}/menu/SMphoto1-1.jpg`]);
    expect(ownerRows()).toEqual([expect.objectContaining({ body: "📎 a photo", parts: [expect.objectContaining({ type: "file", kind: "photo", path: `${R}/menu/SMphoto1-1.jpg` })] })]);
    expect(callDina.mock.calls[0][0].content).toMatch(/has just sent a photo on WhatsApp, saved safely for your menu/);
    expect(sent).toEqual([{ kind: "text", body: "Got your menu photo, thanks." }]);
  });

  test("several photos at once: kept, and answered once, by the last of them", async () => {
    db.tables.onboarding_sessions[0].current_step = "menu";
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]), { headers: { "content-type": "image/jpeg" } }));
    // The webhook logged both before either was handled.
    db.tables.messages.push({ restaurant_id: R, direction: "inbound", from_number: OWNER, body: "[📷 photo]", twilio_sid: "SMp1", created_at: "2026-10-30T10:00:00.000Z" });
    db.tables.messages.push({ restaurant_id: R, direction: "inbound", from_number: OWNER, body: "[📷 photo]", twilio_sid: "SMp2", created_at: "2026-10-30T10:00:01.000Z" });
    callDina.mockResolvedValueOnce(answer({ text: "Got both pages." }));
    const photo = (sid: string) => whatsapp("", { messageSid: sid, media: [{ url: `https://api.twilio.com/m/${sid}`, contentType: "image/jpeg" }] });
    await photo("SMp1");
    expect(callDina).not.toHaveBeenCalled(); // a later photo is on its way
    await photo("SMp2");
    expect(callDina).toHaveBeenCalledTimes(1);
    expect(callDina.mock.calls[0][0].content).toMatch(/has just sent 2 photos/);
    expect(sent).toEqual([{ kind: "text", body: "Got both pages." }]);
    expect(ownerRows()).toHaveLength(2);
  });

  test("a file that isn't accepted: a friendly line from code, nothing kept, no Claude", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), { headers: { "content-type": "video/mp4" } }));
    await whatsapp("", { media: [{ url: "https://api.twilio.com/m/v", contentType: "video/mp4" }] });
    expect(callDina).not.toHaveBeenCalled();
    expect(db.files.size).toBe(0);
    expect(sent).toEqual([{ kind: "text", body: expect.stringMatching(/^I can't open that kind of file/) }]);
  });

  test("a file over 16 MB is refused before it's all downloaded", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(4), { headers: { "content-type": "application/pdf", "content-length": String(17 * 1024 * 1024) } }));
    await whatsapp("", { media: [{ url: "https://api.twilio.com/m/big", contentType: "application/pdf" }] });
    expect(db.files.size).toBe(0);
    expect(sent[0].body).toMatch(/too big for me/);
  });

  test("linked after starting on the web: Dina says welcome back at the step they're on", async () => {
    db.tables.onboarding_messages.push({ id: "aaaaaaaa-0000-4000-8000-000000000001", restaurant_id: R, role: "dina", channel: "web", body: "Hi Amina.", parts: [], created_at: "2026-10-30T10:00:00.000Z" });
    callDina.mockResolvedValueOnce(answer({ text: "You're linked. Welcome back, let's carry on with your basics." }));
    const { greetOnWhatsApp } = await import("@/lib/onboarding/dina/whatsapp-turn");
    await greetOnWhatsApp(R, OWNER, OURS);
    expect(callDina.mock.calls[0][0].content).toMatch(/The owner is back after a break/);
    expect(callDina.mock.calls[0][0].content).toMatch(/linked to the restaurant just now/);
    expect(sent).toEqual([{ kind: "text", body: "You're linked. Welcome back, let's carry on with your basics." }]);
  });
});
