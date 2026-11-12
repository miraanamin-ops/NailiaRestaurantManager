// Setup in chapters, led by code (the owner's plan, 7 Nov 2026): every question
// in code, a step only done when each is answered or skipped on purpose, a Confirm
// on every decision, "skip this question" apart from "do this chapter later", a
// recap at the end of each chapter, and the owner's colours from their website.
// Pure rules first, then whole answers on the in-memory database.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { availableSteps, complete, enter, skip, wait, type FlowState } from "@/lib/onboarding/flow";
import { availableChapters, chapterIntro, chapterOrder, CHAPTERS } from "@/lib/onboarding/guide/chapters";
import { gateStep, nextAction, openQuestions, QUESTIONS, questionsFor, recapId, withRecord, withReask, type Facts } from "@/lib/onboarding/guide/questions";
import { askFor, inputsFrom, recapFor, recapText, signOffChoices } from "@/lib/onboarding/guide/cards";
import { coloursIn, contrastWithWhite, DEFAULT_PALETTE, paletteChoices, stylesheetsIn } from "@/lib/onboarding/guide/palette";
import { parseTones } from "@/lib/onboarding/dina/tones";
import { dinaReplyProblems } from "@/lib/onboarding/dina/reply";
import { EMOJI_NO, EMOJI_YES } from "@/lib/onboarding/dina/details-content";
import { memoryDb } from "./support/memory-db";
import tonesFile from "../agents/tones.config.json";

const T = "2026-11-07T10:00:00.000Z";
const tones = parseTones(tonesFile);
const facts = (state: FlowState, r: Record<string, unknown> = {}, confirmed: string[] = []): Facts => ({ r: { name: "Ember Grill", owner_name: "Amina Khan", ...r }, confirmed: new Set(confirmed), state });
const inputs = (f: Facts) => inputsFrom({ restaurant: f.r, state: f.state, tones });
const hello = () => complete({}, "hello", "done", {}, T);
// Chapters 1 and 2 dealt with: Hello and its recap, Google skipped.
const CH1 = QUESTIONS.filter((q) => q.step === "hello" && q.asker === "code").map((q) => q.id);
const through2 = () => {
  let s = hello();
  let d = withRecord(s.hello!.data, recapId("restaurant"), "answered", T);
  for (const id of CH1) d = withRecord(d, id, "answered", T);
  s = { ...s, hello: { ...s.hello!, data: d } };
  return skip(s, "google", T);
};

describe("the chapters", () => {
  test("every step of setup is in one chapter, in the flow's order; Google has no recap", () => {
    expect(chapterOrder()).toEqual(availableSteps());
    expect(availableChapters().map((c) => c.key)).toEqual(["restaurant", "google", "look_voice", "menu", "offers", "customers", "sales_team", "calendar", "working"]);
    expect(CHAPTERS.google.recap).toBe(false);
    expect(questionsFor("google", facts({})).map((q) => q.id)).toEqual(["google.base"]);
    expect(questionsFor("tone", facts({})).map((q) => q.id)).toEqual(["tone.praise", "tone.complaint", "tone.sign_off", "tone.emoji", "recap.look_voice"]);
  });

  test("a chapter opens with its number, title and what it covers; the words pass Dina's checks", () => {
    expect(chapterIntro(CHAPTERS.look_voice)).toBe("Chapter 3 of 9: Your look and voice. About 4 minutes on your logo, your colours, your tone and how you sign off.");
    for (const c of availableChapters()) expect(dinaReplyProblems({ messages: [{ text: chapterIntro(c), component: null }, { text: recapText(c.key), component: null }] })).toEqual([]);
  });
});

describe("a step is only done when each of its questions is", () => {
  test("both tones saved: still open for the sign-off, emoji and the chapter's recap; then done", () => {
    let s = complete(enter(through2(), "tone", T), "tone", "done", { picks: { praise: { tone: "warm" }, complaint: { tone: "short" } } }, T);
    const f = facts(s);
    s = gateStep(s, "tone", f, T);
    expect(s.tone?.status).toBe("in_progress");
    expect(openQuestions("tone", facts(s)).map((q) => q.id)).toEqual(["tone.sign_off", "tone.emoji", "recap.look_voice"]);
    const answered = facts(s, { sign_off_name: "Amina, Ember Grill" }, ["emoji_allowed"]);
    s = { ...s, tone: { ...s.tone!, data: withRecord(s.tone!.data, recapId("look_voice"), "answered", T) } };
    expect(gateStep(s, "tone", { ...answered, state: s }, T).tone?.status).toBe("done");
  });

  test("an essential question skipped makes the step half done (a gap); skipped and waiting steps are left alone", () => {
    let s = enter(through2(), "tone", T);
    for (const id of ["tone.praise", "tone.complaint", "tone.emoji", recapId("look_voice")]) s = { ...s, tone: { ...s.tone!, data: withRecord(s.tone!.data, id, "answered", T) } };
    s = { ...s, tone: { ...s.tone!, data: withRecord(s.tone!.data, "tone.sign_off", "skipped", T) } };
    expect(gateStep(s, "tone", facts(s), T).tone?.status).toBe("partial");
    const skipped = skip(through2(), "tone", T);
    expect(gateStep(skipped, "tone", facts(skipped), T)).toBe(skipped);
    const waiting = wait(hello(), "google", "google", {}, T);
    expect(gateStep(waiting, "google", facts(waiting), T)).toBe(waiting);
  });

  test("a step already finished stays finished when looked at again (older setups have no recap); Change on a recap opens it", () => {
    const done = complete(hello(), "menu", "done", {}, T);
    expect(gateStep(done, "menu", facts(done), T, done).menu?.status).toBe("done");
    const reasked = { ...done, menu: { ...done.menu!, data: withReask(done.menu!.data, "menu.base", T) } };
    expect(gateStep(reasked, "menu", facts(reasked), T, done).menu?.status).toBe("in_progress");
    // The step's own tool finishing it again answers the Change.
    expect(complete(reasked, "menu", "done", {}, T).menu?.data.q).toEqual({});
  });
});

describe("what's next is decided by code", () => {
  test("chapter 3 in order: logo, colours, dish photos, the two tones, sign-off, emoji, then the recap", () => {
    let s = through2();
    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = nextAction(facts(s));
      if (a.kind === "end" || a.kind === "dina") break;
      const id = a.kind === "ask" ? a.question.id : recapId(a.chapter);
      order.push(id);
      const q = QUESTIONS.find((x) => x.id === id) ?? { step: "tone" as const };
      const st = s[q.step] ?? { status: "in_progress" as const, data: {}, waitingOn: null, startedAt: T, completedAt: null, skippedAt: null };
      s = { ...s, [q.step]: { ...st, status: "in_progress", data: withRecord(st.data, id, "answered", T) } };
      s = gateStep(s, q.step, facts(s), T);
    }
    expect(order).toEqual(["look.logo", "look.colours", "look.photos", "tone.praise", "tone.complaint", "tone.sign_off", "tone.emoji", "recap.look_voice"]);
    expect(nextAction(facts(s))).toMatchObject({ kind: "dina", step: "menu", question: { id: "menu.base" } });
  });

  test("Hello and Google are Dina's; a Google invite waiting doesn't hold the owner up", () => {
    expect(nextAction(facts({}))).toMatchObject({ kind: "dina", step: "hello" });
    const s = wait(through2(), "google", "google", {}, T);
    expect(nextAction(facts(s))).toMatchObject({ kind: "ask", question: { id: "look.logo" } });
  });
});

describe("code's question cards", () => {
  test("every code question has a card whose words pass Dina's checks; every decision has a Confirm and a skip", () => {
    const s = through2();
    const f = facts(s, { logo_url: "https://s.test/logo.png" });
    for (const q of QUESTIONS.filter((x) => x.asker === "code")) {
      const asked = askFor(q.id, f, inputs(f));
      expect(asked, q.id).not.toBeNull();
      expect(dinaReplyProblems({ messages: [{ text: asked!.text, component: null }] }), q.id).toEqual([]);
      if (q.decision) expect(asked!.card, q.id).toMatchObject({ confirm: true, skip: true });
    }
  });

  test("tones: the review, a card per tone with its reply, and their own words; what's saved shows picked", () => {
    let s = through2();
    s = { ...s, tone: { status: "in_progress", data: { picks: { praise: { tone: "warm", own: false } } }, waitingOn: null, startedAt: T, completedAt: null, skippedAt: null } };
    const f = facts(s);
    const praise = askFor("tone.praise", f, inputs(f))!;
    expect(praise.text).toMatch(/typical good review.*Which reply sounds most like you\?$/);
    expect(praise.card).toMatchObject({ layout: "cards", confirm: true, quote: { author: "Sarah", real: false }, input: { optionId: "own" }, selected: ["warm"] });
    expect(praise.card.options.map((o) => o.id)).toEqual(["warm", "polished", "fun", "short", "own"]);
  });

  test("sign-off: their first name and the restaurant, the team, or their own words", () => {
    expect(signOffChoices("Amina", "Ember Grill")).toEqual(["Amina, Ember Grill", "The Ember Grill team", "Amina and the team"]);
    const f = facts(through2());
    expect(askFor("tone.sign_off", f, inputs(f))!.card.options.map((o) => o.label)).toEqual(["Amina, Ember Grill", "The Ember Grill team", "Amina and the team", "Something else"]);
  });

  test("colours: the website's choices as swatches, plus 'Choose my own'", () => {
    let s = through2();
    s = { ...s, look: { status: "in_progress", data: { palettes: [{ id: "site_1", main: "#1b5e20", second: "#0b2e10", from: "website" }, DEFAULT_PALETTE] }, waitingOn: null, startedAt: T, completedAt: null, skippedAt: null } };
    const f = facts(s);
    const c = askFor("look.colours", f, inputs(f))!;
    expect(c.text).toMatch(/^I picked these colours up from your website\./);
    expect(c.card.options).toEqual([
      expect.objectContaining({ id: "site_1", label: "From your website", swatches: ["#1b5e20", "#0b2e10"] }),
      expect.objectContaining({ id: "default", label: "Our suggestion", swatches: ["#c2410c", "#1c1917"] }),
      expect.objectContaining({ id: "own", label: "Choose my own" }),
    ]);
  });

  test("the recap: a row per question with what's saved, a skipped one says so", () => {
    let s = through2();
    s = { ...s, look: { status: "in_progress", data: { q: { "look.photos": { status: "skipped", at: T } } }, waitingOn: null, startedAt: T, completedAt: null, skippedAt: null } };
    s = { ...s, tone: { status: "in_progress", data: { picks: { praise: { tone: "warm", own: false }, complaint: { tone: null, own: true } } }, waitingOn: null, startedAt: T, completedAt: null, skippedAt: null } };
    const f = facts(s, { logo_url: "https://s.test/l.png", brand_color: "#1b5e20", brand_dark: "#0b2e10", sign_off_name: "Amina", emoji_allowed: EMOJI_NO }, ["logo", "colours", "emoji_allowed"]);
    const recap = recapFor("look_voice", f, { tones }, () => null);
    expect(recap.rows.map((r) => [r.label, r.value, r.status])).toEqual([
      ["Logo", "Saved", "answered"],
      ["Colours", "Saved", "answered"],
      ["Dish photos", "Skipped for now", "skipped"],
      ["Replies to good reviews", "Warm and personal", "answered"],
      ["Replies to bad reviews", "Your own words", "answered"],
      ["How replies are signed", "Amina", "answered"],
      ["Emoji", "None", "answered"],
    ]);
    expect(recap.rows[1].swatches).toEqual(["#1b5e20", "#0b2e10"]);
    expect(recap.next).toBe("Your menu and margins");
  });
});

describe("colours from the website", () => {
  test("the theme colour first, then the most used; whites, blacks and greys don't count", () => {
    const html = `<meta name="theme-color" content="#1b5e20"><style>a{color:#c62828} b{color:#c62828} body{background:#ffffff;color:#111} .x{color:#888888} .y{background:rgb(21, 101, 192)}</style>`;
    expect(coloursIn([html], "#1b5e20")).toEqual(["#1b5e20", "#c62828", "#1565c0"]);
  });

  test("up to three choices, each with a second colour white text reads on; our default when the site has few", () => {
    const choices = paletteChoices(["#1b5e20", "#c62828", "#1565c0", "#1b5e21"]);
    expect(choices.map((p) => p.main)).toEqual(["#1b5e20", "#c62828", "#1565c0"]);
    for (const p of choices) expect(contrastWithWhite(p.second)).toBeGreaterThanOrEqual(7);
    expect(paletteChoices([])).toEqual([DEFAULT_PALETTE]);
    expect(paletteChoices(["#f9a825"]).map((p) => p.id)).toEqual(["site_1", "default"]);
  });

  test("linked stylesheets, at most three, as full addresses", () => {
    const html = `<link rel="stylesheet" href="/a.css"><link href="https://cdn.test/b.css" rel="stylesheet"><link rel="icon" href="/i.png"><link rel="stylesheet" href="data:text/css,x">`;
    expect(stylesheetsIn(html, "https://ember.test/menu")).toEqual(["https://ember.test/a.css", "https://cdn.test/b.css"]);
  });
});

describe("drawn for WhatsApp", () => {
  test("a question: its options as a list or buttons, then 'Skip this question'; a number picks", async () => {
    const { renderForWhatsApp, readWhatsAppReply, choicesOf } = await import("@/lib/onboarding/dina/whatsapp");
    const f = facts(through2());
    const asked = askFor("tone.emoji", f, inputs(f))!;
    const component = { type: "question" as const, card: asked.card };
    expect(choicesOf(component).map((c) => c.label)).toEqual(["Yes, a couple", "No emoji", "Skip this question"]);
    const outs = renderForWhatsApp([{ id: "m1", role: "dina", text: asked.text, component }], { skippable: true, chatUrl: "https://app.test/c", appUrl: "https://app.test" });
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ kind: "buttons", body: expect.stringMatching(/Reply 1, 2 or 3$/) });
    expect(readWhatsAppReply({ body: "2" }, { messageId: "m1", component }, true)).toEqual({ kind: "answer", messageId: "m1", choiceId: "no", label: "No emoji" });
  });

  test("a recap: the rows as text, then Looks right and a Change for each", async () => {
    const { renderForWhatsApp } = await import("@/lib/onboarding/dina/whatsapp");
    const recap = { chapter: "offers", title: "Offers and limits", next: null, rows: [{ q: "rewards.base", label: "Rewards and limits", value: "A free dessert; never over 15% off", status: "answered" as const }] };
    const outs = renderForWhatsApp([{ id: "m2", role: "dina", text: "Check it.", component: { type: "recap", recap } }], { skippable: true, chatUrl: "https://app.test/c", appUrl: "https://app.test" });
    expect(outs[0]).toMatchObject({ kind: "text", body: expect.stringContaining("✅ Rewards and limits: A free dessert; never over 15% off") });
    expect(outs[1]).toMatchObject({ options: [{ title: "Looks right" }, { title: "Change: Rewards and lim…" }] });
    expect((outs[1] as { body: string }).body).toContain("*1* Looks right\n*2* Change: Rewards and limits");
  });
});

// ---------- Whole answers, on the in-memory database ----------

const R = "dddddddd-0000-4000-8000-0000000000e1";
let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.resetModules();
  db = memoryDb({
    restaurants: [{ id: R, name: "Ember Grill", slug: "ember-grill", owner_name: "Amina Khan", website: null, logo_url: null, brand_color: "#c2410c", brand_dark: "#1c1917", emoji_allowed: EMOJI_YES, sign_off_name: null, photo_library: [], menu: [], profile_version: 0, brand_voice: null, profile_examples: {} }],
    onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "look", channel_last_used: "web", started_at: T, completed_at: null }],
    onboarding_steps: [
      { restaurant_id: R, step_key: "hello", status: "done", data: { _outcome: "done", q: Object.fromEntries(["recap.restaurant", ...CH1].map((id) => [id, { status: "answered", at: T }])) }, completed_at: T },
      { restaurant_id: R, step_key: "google", status: "skipped", data: {}, skipped_at: T },
    ],
    onboarding_messages: [],
    onboarding_ai_usage: [],
    onboarding: [],
    setup_gaps: [],
    audit_log: [],
    profile_versions: [],
    reviews: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, structuredClone(fields)),
  }));
  vi.doMock("@/lib/photos", async (orig) => ({ ...(await orig<object>()), saveLogo: async () => "https://storage.test/logo.png", savePostPhoto: async () => `https://storage.test/dish-${Math.random().toString(36).slice(2, 8)}.jpg` }));
  vi.doMock("@/lib/onboarding/dina/uploads-store", async (orig) => ({ ...(await orig<object>()), readSavedFile: async () => Buffer.from([0xff, 0xd8, 0xff, 0x00]) }));
  vi.doMock("@/lib/google", async (orig) => ({ ...(await orig<object>()), google: () => ({ listReviews: async () => [] }) }));
  // No Claude in these: code asks every question here.
  vi.doMock("@/lib/onboarding/dina/call", async (orig) => ({ ...(await orig<object>()), callDina: vi.fn(async () => { throw new Error("Claude shouldn't be called"); }) }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/ops/menu", "@/lib/photos", "@/lib/onboarding/dina/uploads-store", "@/lib/google", "@/lib/onboarding/dina/call"]) vi.doUnmock(m);
});

const r = () => db.tables.restaurants[0];
const step = (k: string) => db.tables.onboarding_steps.find((s) => s.step_key === k);
const lastDina = () => db.tables.onboarding_messages.filter((m) => m.role === "dina").at(-1)!;
const photo = { type: "file" as const, path: `${R}/incoming/logo.png`, kind: "photo" as const, contentType: "image/png", bytes: 4 };

// What code shows next (as the chat would), after a pick it handled.
async function showNext() {
  const { codeTurn } = await import("@/lib/onboarding/dina/turn");
  return codeTurn({ restaurantId: R, channel: "web", text: "start", messages: [{ text: "Let's go.", component: null }] });
}
async function pick(choiceIds: string[], opts: { text?: string; channel?: "web" | "whatsapp"; confirmed?: boolean } = {}) {
  const { guidePick } = await import("@/lib/onboarding/guide/handle");
  const { codeTurn } = await import("@/lib/onboarding/dina/turn");
  const on = lastDina();
  const g = await guidePick({ restaurantId: R, messageId: on.id as string, choiceIds, text: opts.text ?? null, channel: opts.channel ?? "web", confirmed: opts.confirmed ?? true });
  expect(g).not.toBeNull();
  await codeTurn({ restaurantId: R, channel: opts.channel ?? "web", text: choiceIds.join(","), messages: g!.messages, ownerParts: [{ type: "answer", to: on.id, choice: choiceIds.join(",") }] });
  return g!;
}

describe("chapter 3, answered on the web", () => {
  test("the chapter opens, then each question in turn; every answer is saved as confirmed; the recap closes it", async () => {
    await showNext();
    const said = db.tables.onboarding_messages.filter((m) => m.role === "dina").map((m) => m.body);
    expect(said).toContain("Chapter 3 of 9: Your look and voice. About 4 minutes on your logo, your colours, your tone and how you sign off.");
    expect(lastDina().parts).toEqual([{ type: "question", q: "look.logo" }]);

    // The logo they send: kept as a draft and shown to them; nothing saved until they confirm.
    const { guideFiles } = await import("@/lib/onboarding/guide/handle");
    expect((await guideFiles({ restaurantId: R, files: [photo], channel: "web" }))?.messages[0].text).toBe("Got it. Here's how it looks.");
    expect(r().logo_url).toBeNull();
    const { codeTurn } = await import("@/lib/onboarding/dina/turn");
    await codeTurn({ restaurantId: R, channel: "web", text: "📎 a photo", messages: [{ text: "Got it. Here's how it looks.", component: null }] });
    expect(lastDina().parts).toEqual([{ type: "question", q: "look.logo" }]);
    await pick(["use"]);
    expect(r().logo_url).toBe("https://storage.test/logo.png");

    expect(lastDina().parts).toEqual([{ type: "question", q: "look.colours" }]);
    await pick(["own"], { text: "dark green and cream" });
    expect(r()).toMatchObject({ brand_color: "#1b5e20" });
    expect(contrastWithWhite(r().brand_dark as string)).toBeGreaterThanOrEqual(4.5);

    expect(lastDina().parts).toEqual([{ type: "question", q: "look.photos" }]);
    await pick(["skip_q"]);
    expect(step("look")?.status).toBe("done");

    expect(lastDina().parts).toEqual([{ type: "question", q: "tone.praise" }]);
    await pick(["warm"]);
    await pick(["own"], { text: "So sorry about your visit. Please get in touch and we'll put it right." });
    expect(r().profile_examples).toMatchObject({ review_replies: { positive: { style: "Warm and personal" }, negative: { own: true } } });
    expect(step("tone")?.status).toBe("in_progress");

    await pick(["s1"]);
    expect(r().sign_off_name).toBe("Amina, Ember Grill");
    await pick(["no"]);
    expect(r().emoji_allowed).toEqual(EMOJI_NO);

    // The recap: Change asks that question again; Looks right closes the chapter.
    expect(lastDina().parts).toEqual([{ type: "recap", chapter: "look_voice" }]);
    await pick(["change:tone.sign_off"]);
    expect(lastDina().parts).toEqual([{ type: "question", q: "tone.sign_off" }]);
    await pick(["s2"]);
    expect(r().sign_off_name).toBe("The Ember Grill team");
    expect(lastDina().parts).toEqual([{ type: "recap", chapter: "look_voice" }]);
    const fields = new Set(db.tables.profile_versions.map((v) => v.field));
    for (const f of ["logo", "colours", "sign_off_name", "emoji_allowed"]) expect(fields.has(f), f).toBe(true);
    // Looks right: done, and setup moves on to the menu (Dina's), so a Dina turn would follow.
    const { confirmRecap } = await import("@/lib/onboarding/guide/answer");
    await confirmRecap(R, "look_voice", "web");
    expect(step("tone")?.status).toBe("done");
    const { loadFacts } = await import("@/lib/onboarding/guide/next");
    expect(nextAction(await loadFacts(R))).toMatchObject({ kind: "dina", step: "menu" });
  });

  test("a decision read back first when it isn't confirmed on a card (WhatsApp, or typed): saved only on 'Yes, save it'", async () => {
    await showNext();
    await pick(["skip_q"]); // the logo, for later
    expect(step("look")?.data.q).toMatchObject({ "look.logo": { status: "skipped" } });
    expect(lastDina().parts).toEqual([{ type: "question", q: "look.colours" }]);
    const g = await pick(["default"], { channel: "whatsapp", confirmed: false });
    expect(g.messages[0]).toMatchObject({ text: "You picked: Our suggestion. Shall I save that?", component: { type: "pick_confirm", q: "look.colours" } });
    expect(db.tables.profile_versions.some((v) => v.field === "colours")).toBe(false);
    await pick(["pick_again"], { channel: "whatsapp", confirmed: false });
    expect(db.tables.profile_versions.some((v) => v.field === "colours")).toBe(false);
    expect(lastDina().parts).toEqual([{ type: "question", q: "look.colours" }]);
    await pick(["default"], { channel: "whatsapp", confirmed: false });
    await pick(["pick_ok"], { channel: "whatsapp", confirmed: false });
    expect(db.tables.profile_versions.some((v) => v.field === "colours")).toBe(true);
    // A typed answer to a card that takes words: read back too.
    await pick(["skip_q"]); // photos
    await pick(["warm"]);
    await pick(["short"]);
    expect(lastDina().parts).toEqual([{ type: "question", q: "tone.sign_off" }]);
    const { guideTyped } = await import("@/lib/onboarding/guide/handle");
    const typed = await guideTyped({ restaurantId: R, text: "Amina x", channel: "web", asking: { messageId: lastDina().id as string, part: { type: "question", q: "tone.sign_off" } } });
    expect(typed?.messages[0]).toMatchObject({ text: "You picked: Amina x. Shall I save that?", component: { type: "pick_confirm", q: "tone.sign_off" } });
    expect(r().sign_off_name).toBeNull();
    // A question isn't an answer: Dina takes it.
    expect(await guideTyped({ restaurantId: R, text: "What's a sign-off?", channel: "web", asking: { messageId: lastDina().id as string, part: { type: "question", q: "tone.sign_off" } } })).toBeNull();
  });

  test("'Skip this question' skips only that question; 'Do this chapter later' skips the rest of the chapter, each step a gap", async () => {
    await showNext();
    await pick(["skip_q"]);
    expect(step("look")?.status).toBe("in_progress");
    expect(step("tone")).toBeUndefined();
    const { guideSkipAsk, guidePick } = await import("@/lib/onboarding/guide/handle");
    const ask = await guideSkipAsk(R, "look");
    expect(ask?.messages[0]).toMatchObject({ text: expect.stringMatching(/^Do the rest of Your look and voice later\?/), component: { type: "chapter_skip", chapter: "look_voice" } });
    db.tables.onboarding_messages.push({ id: "eeeeeeee-0000-4000-8000-000000000001", restaurant_id: R, role: "dina", body: "Later?", parts: [{ type: "chapter_skip", chapter: "look_voice" }], created_at: new Date().toISOString() });
    await guidePick({ restaurantId: R, messageId: "eeeeeeee-0000-4000-8000-000000000001", choiceIds: ["chapter_later"], channel: "web", confirmed: false });
    expect([step("look")?.status, step("tone")?.status]).toEqual(["skipped", "skipped"]);
    expect(db.tables.setup_gaps.map((g) => g.step_key)).toEqual(expect.arrayContaining(["look", "tone"]));
    // Skipping the tone keeps a safe default voice.
    expect(r().brand_voice).toMatch(/^Warm and personal/);
  });
});

describe("chapters 5, 6 and 9, answered", () => {
  test("offers: the reward must fit the cap; settings saved; the typed sending hours checked; a customer list only added when they agreed", async () => {
    Object.assign(r(), { signup_reward: null, discount_cap_percent: 15, recovery_offers: [], brief_hour: 9 });
    db.tables.customers = [];
    db.tables.consents = [];
    const { answerQuestion } = await import("@/lib/onboarding/guide/answer");
    // A 20% reward over a 15% cap is refused, then fine once the cap is 25%.
    expect(await answerQuestion({ restaurantId: R, q: "offers.reward", picked: ["own"], typed: "20% off your first visit", channel: "web" })).toMatchObject({ ok: false, said: expect.stringMatching(/15%/) });
    expect(await answerQuestion({ restaurantId: R, q: "offers.cap", picked: ["cap25"], channel: "web" })).toMatchObject({ ok: true });
    expect(await answerQuestion({ restaurantId: R, q: "offers.reward", picked: ["own"], typed: "20% off your first visit", channel: "web" })).toMatchObject({ ok: true });
    expect(r()).toMatchObject({ discount_cap_percent: 25, signup_reward: "20% off your first visit" });
    await answerQuestion({ restaurantId: R, q: "offers.no_discount", picked: ["friday", "saturday"], channel: "web" });
    expect(r().no_discount_days).toEqual(["friday", "saturday"]);

    // Sending hours typed: inside 7am to 10pm, saved; outside, refused.
    expect(await answerQuestion({ restaurantId: R, q: "working.window", picked: ["own"], typed: "6am to 8pm", channel: "web" })).toMatchObject({ ok: false });
    expect(await answerQuestion({ restaurantId: R, q: "working.window", picked: ["own"], typed: "10am to 8pm", channel: "web" })).toMatchObject({ ok: true });
    expect(r()).toMatchObject({ send_window_start: "10:00:00", send_window_end: "20:00:00" });
    await answerQuestion({ restaurantId: R, q: "working.quiet", picked: ["q22_8"], channel: "web" });
    expect(r()).toMatchObject({ quiet_hours_start: "22:00:00", quiet_hours_end: "08:00:00" });

    // The customer list: "not sure" adds nobody; "they signed up" adds them unconfirmed, with their consent record.
    const draft = { rows: [{ email: "sara@x.test", name: "Sara", birthday: null }, { email: "omar@y.test", name: "Omar", birthday: "1985-07-02" }], count: 2, skipped: 0 };
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "customers_qr", status: "in_progress", data: { import_draft: draft } });
    await answerQuestion({ restaurantId: R, q: "customers.consent", picked: ["not_sure"], channel: "web" });
    expect(db.tables.customers).toEqual([]);
    step("customers_qr")!.data = { import_draft: draft };
    expect(await answerQuestion({ restaurantId: R, q: "customers.consent", picked: ["agreed"], channel: "web" })).toMatchObject({ ok: true, said: expect.stringMatching(/^Added 2 customers/) });
    expect(db.tables.customers.map((c) => [c.email, c.source, c.marketing_opt_in, c.email_confirmed_at ?? null])).toEqual([
      ["sara@x.test", "import", false, null],
      ["omar@y.test", "import", false, null],
    ]);
    expect(db.tables.consents).toHaveLength(2);
    expect(db.tables.consents[0]).toMatchObject({ granted: true, source: "import" });
    expect(db.tables.consents[0].confirmed_at ?? null).toBeNull();
  });
});

describe("chapter 7's team questions (12 Nov 2026)", () => {
  const T2 = "2026-11-12T10:00:00.000Z";
  const teamState = (data: Record<string, unknown>) => {
    const s = enter(through2(), "team", T2);
    return { ...s, team: { ...s.team, data } } as FlowState;
  };
  const ids = (f: Facts) => questionsFor("team", f).map((q) => q.id);

  test("rotas first; the check only once something was read; staffing and labour only once the team is saved", () => {
    expect(ids(facts(teamState({})))).toEqual(["team.rotas", "team.method", "team.base", "recap.sales_team"]);
    const read = { rota_import: { shifts: [{ name: "Ali", role: "chef", date: "2026-11-02", start: 1020, end: 1380 }], weeks: 1, assumed: false, unplaced: 0 } };
    expect(ids(facts(teamState(read)))).toEqual(["team.rotas", "team.rotas_check", "team.method", "team.base", "recap.sales_team"]);
    const f = facts(teamState({ ...read, staff: 3, _outcome: "done" }));
    expect(ids(f)).toEqual(["team.rotas", "team.rotas_check", "team.method", "team.base", "team.staffing", "team.labour", "recap.sales_team"]);
    // The check isn't confirmed yet: it's the first open question.
    expect(openQuestions("team", f)[0].id).toBe("team.rotas_check");
  });

  test("the check card shows a row per person; the staffing card carries its rows; the labour card offers what the rotas ran at", () => {
    const f = facts(
      teamState({
        rota_import: { shifts: [{ name: "Ali", role: "chef", date: "2026-11-02", start: 1020, end: 1380 }], weeks: 1, assumed: true, unplaced: 0 },
        staff: 1,
        _outcome: "done",
        staffing_card: { rows: [{ role: "chef", label: "Chef", hint: "", min: 2, per: 15, orders: "orders", suggested: { min: 2, per: 15 }, learned: null, edges: null }], notes: [], source: "suggested" },
        staffing_band: "30_60",
        rota_labour: { pct: 31.4, days: 12 },
      }),
    );
    const check = askFor("team.rotas_check", f, inputs(f))!;
    expect(check.text).toMatch(/^I read 1 week .*1 person and 1 shifts\. I couldn't see dates on it, so I've taken it as your last week\. Is this right\?$/);
    expect(check.card.table).toEqual({ columns: ["Name", "Role", "Shifts", "Usually"], rows: [["Ali", "Chef", "1", "Mon, 5pm to 11pm"]] });
    const staffing = askFor("team.staffing", f, inputs(f))!;
    expect(staffing.card).toMatchObject({ confirm: true, skip: true, staffing: { rows: [{ role: "chef", min: 2 }] } });
    expect(dinaReplyProblems({ messages: [{ text: staffing.text, component: null }] })).toEqual([]);
    const labour = askFor("team.labour", f, inputs(f))!;
    expect(labour.card.options.map((o) => o.label)).toEqual(["31% (what your rotas ran at)", "25%", "30%", "35%"]);
  });
});
