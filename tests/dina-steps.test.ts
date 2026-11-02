// Phase 6: Dina's steps 2 and 3 (and Hello's Google Maps pre-fill). The fixed
// words and rules as plain code (google-content.ts, tones.ts), how their cards
// are drawn on the web and WhatsApp, then whole turns on the in-memory database:
// the Google questions (no profile = a setup gap, not an owner = waiting on
// whoever is), "Done, I've invited you" (accepted at once in dummy mode, with the
// reviews and rating), "Email me these steps", the 24-hour nudge (once), the
// builder marking Google accepted, tone taps saved by code, "Write my own",
// skipping (Warm and personal), real reviews (replies written for them, queued
// as held drafts, checked). Claude, Twilio and email are stand-ins.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { acceptedText, forwardMessage, googleNudgeDue, managerSteps, NUDGE_TEXT, REASSURANCE, stepsEmail } from "@/lib/onboarding/dina/google-content";
import { stepDataForPrompt } from "@/lib/onboarding/dina/prompt";
import { dinaReplyProblems } from "@/lib/onboarding/dina/reply";
import { defaultOptions, exampleFrom, parseTones, pickToneReviews, toneCards, type ReviewForTone } from "@/lib/onboarding/dina/tones";
import { chatMessage, type CardSources } from "@/lib/onboarding/dina/view";
import { renderForWhatsApp } from "@/lib/onboarding/dina/whatsapp";
import { parseBuilderCommand } from "@/lib/feeds/builder-parse";
import { memoryDb } from "./support/memory-db";

const TONES = parseTones(JSON.parse(readFileSync("agents/tones.config.json", "utf8")));
const fine = (text: string) => expect(dinaReplyProblems({ messages: [{ text, component: null }] })).toEqual([]);

describe("the tone config (agents/tones.config.json)", () => {
  test("four tones, your default reviews and a reply in each tone; short labels fit a WhatsApp button", () => {
    expect(TONES.tones.map((t) => t.name)).toEqual(["Warm and personal", "Polished and professional", "Fun and chatty", "Short and simple"]);
    expect(TONES.tones.every((t) => t.short.length <= 20)).toBe(true);
    expect(TONES.defaults.praise.author).toBe("Sarah");
    expect(TONES.defaults.complaint.replies.short).toBe("Sorry James, that wait and the cold chips aren't good enough. We've shared this with the team. Please get in touch so we can put it right.");
  });

  test("a bad file is refused with the exact problem: a missing reply, an em-dash, a long button label", () => {
    const raw = JSON.parse(readFileSync("agents/tones.config.json", "utf8"));
    const missing = structuredClone(raw);
    delete missing.defaults.praise.replies.fun;
    expect(() => parseTones(missing)).toThrow(/defaults.praise.replies is missing fun/);
    const dash = structuredClone(raw);
    dash.defaults.complaint.replies.warm = "Sorry James — that's not right at all, please come back.";
    expect(() => parseTones(dash)).toThrow(/no em-dashes/);
    const long = structuredClone(raw);
    long.tones[1].short = "Polished and professional";
    expect(() => parseTones(long)).toThrow(/tones.1.short/);
  });
});

describe("which real reviews set the tone (the owner's rules)", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const words = (n: number, lead = "") => `${lead} ${Array.from({ length: n }, () => "lovely").join(" ")}`.trim();
  const review = (over: Partial<ReviewForTone>): ReviewForTone => ({ id: Math.random().toString(36).slice(2), author_name: "A", rating: 5, text: words(20), review_date: "2026-09-01", replied: false, reply_text: null, ...over });

  test("praise: 5 stars with 15+ words, recent, naming a person or dish first, unanswered first", () => {
    const short = review({ id: "short", text: "Great food!" });
    const old = review({ id: "old", text: words(20, "The staff were great."), review_date: "2024-01-01" });
    const plain = review({ id: "plain" });
    const specific = review({ id: "specific", text: words(20, "The mixed grill was superb.") });
    const answered = review({ id: "answered", text: words(20, "Our waiter Sam was brilliant."), replied: true, reply_text: "Thanks!" });
    const four = review({ id: "four", rating: 4, text: words(20, "The staff were great.") });
    expect(pickToneReviews([short, old, plain, answered, specific, four], now, ["Mixed grill"]).praise?.id).toBe("specific");
    expect(pickToneReviews([short, four], now).praise).toBeNull();
  });

  test("complaint: 2 or 3 stars with something specific; never an abusive or 1-star review", () => {
    const vague = review({ id: "vague", rating: 2, text: words(20, "Not great.") });
    const specific = review({ id: "specific", rating: 3, text: words(20, "We waited 50 minutes and the chips were cold.") });
    const abusive = review({ id: "abusive", rating: 2, text: words(20, "The waiters are idiots and the food was cold.") });
    const one = review({ id: "one", rating: 1, text: words(20, "We waited an hour.") });
    expect(pickToneReviews([vague, abusive, one, specific], now).complaint?.id).toBe("specific");
    expect(pickToneReviews([abusive, one], now).complaint).toBeNull();
  });

  test("the cards: the four tones with their replies, then Write my own; a pick becomes the saved example", () => {
    const options = defaultOptions(TONES, "praise");
    expect(toneCards(TONES, options).map((c) => c.short)).toEqual(["Warm and personal", "Polished", "Fun and chatty", "Short and simple", "Write my own"]);
    expect(exampleFrom(TONES, options, { tone: "short" })).toEqual({ review: TONES.defaults.praise.text, reply: "Thanks Sarah! So glad you all enjoyed it. See you again soon.", style: "Short and simple", own: false });
    expect(exampleFrom(TONES, options, { own: "Cheers Sarah, see you soon!" })).toMatchObject({ own: true, style: null });
    expect(exampleFrom(TONES, options, { tone: "nope" })).toBeNull();
  });

  test("Dina sees whether a review is theirs or typical, never its text (outside words stay out of her prompt)", () => {
    const data = { options: { praise: { ...defaultOptions(TONES, "praise"), real: true }, complaint: defaultOptions(TONES, "complaint") }, picks: {} };
    const shown = JSON.stringify(stepDataForPrompt("tone", data));
    expect(shown).toMatch(/"praise":"their own review","complaint":"a typical review"/);
    expect(shown).not.toMatch(/Sarah|James|mixed grill/);
  });
});

describe("the Google step's fixed words", () => {
  test("the four steps, for a phone or a laptop, our email to copy, a screenshot each", () => {
    const phone = managerSteps("phone", "manager@dinerai.co.uk");
    expect(phone.map((s) => s.image)).toEqual(["/onboarding/google/phone-1.png", "/onboarding/google/phone-2.png", "/onboarding/google/phone-3.png", "/onboarding/google/phone-4.png"]);
    expect(phone[1].text).toMatch(/^Tap Menu/);
    expect(managerSteps("laptop", "x@y.z")[1].text).toMatch(/^Click Menu/);
    expect(phone[2]).toMatchObject({ copy: "manager@dinerai.co.uk", text: expect.stringContaining("manager@dinerai.co.uk") });
    expect(phone[3].text).toBe("Under Access, choose Manager, then tap Invite.");
  });

  test("every fixed line passes Dina's own checks (no dashes, one question at most)", () => {
    for (const s of managerSteps("laptop", "m@d.co")) fine(s.text);
    fine(REASSURANCE);
    fine(NUDGE_TEXT);
    fine(forwardMessage("Ember Grill", "m@d.co"));
    fine(acceptedText({ count: 47, average: 4.6 }));
    fine(acceptedText({ count: 0, average: null }));
  });

  test("once we're in: something concrete, and Google's 7-day wait", () => {
    expect(acceptedText({ count: 47, average: 4.6 })).toBe("I'm in! You have 47 reviews and a 4.6 rating. Google makes new managers wait 7 days before some features unlock, so a few things may take a week to switch on.");
    expect(acceptedText({ count: 1, average: 5 })).toMatch(/^I'm in! You have 1 review and a 5.0 rating\./);
    expect(acceptedText({ count: 0, average: null })).toMatch(/^I'm in! Your profile has no reviews yet/);
  });

  test("the forwardable message names the restaurant and our email; the email has the steps and screenshots", () => {
    expect(forwardMessage("Ember Grill", "m@d.co")).toMatch(/Google profile for Ember Grill[\s\S]*Add m@d\.co, choose Manager, then Invite/);
    const email = stepsEmail({ restaurantName: "Ember Grill", device: "phone", managerEmail: "m@d.co", appUrl: "https://app.test" });
    expect(email.subject).toBe("Your steps: adding DinerAI to Ember Grill's Google profile");
    expect(email.text).toMatch(/1\. Open Google Maps[\s\S]*4\. Under Access/);
    expect(email.html).toContain('src="https://app.test/onboarding/google/phone-3.png"');
    expect(stepsEmail({ restaurantName: "E", device: "laptop", managerEmail: "m", appUrl: "u", nudge: true }).text.startsWith(NUDGE_TEXT)).toBe(true);
  });

  test("the nudge: 24 hours after the steps or the invite, once, and only while it's still waiting", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    expect(googleNudgeDue({ status: "in_progress", waitingOn: "google", data: { invited_at: ago(25) } }, now)).toBe("not_accepted");
    expect(googleNudgeDue({ status: "in_progress", waitingOn: "google", data: { invited_at: ago(23) } }, now)).toBeNull();
    expect(googleNudgeDue({ status: "in_progress", waitingOn: null, data: { steps_shown_at: ago(30) } }, now)).toBe("not_invited");
    expect(googleNudgeDue({ status: "in_progress", waitingOn: "google", data: { invited_at: ago(48), nudged_at: ago(20) } }, now)).toBeNull();
    expect(googleNudgeDue({ status: "done", waitingOn: null, data: { steps_shown_at: ago(30) } }, now)).toBeNull();
    expect(googleNudgeDue({ status: "in_progress", waitingOn: "profile_owner", data: { steps_shown_at: ago(30) } }, now)).toBeNull();
  });

  test("the builder's command", () => {
    expect(parseBuilderCommand("BUILDER GOOGLE ACCEPTED ember-spice")).toEqual({ kind: "google_accepted", restaurant: "ember-spice" });
    expect(parseBuilderCommand("builder google accepted for Ember & Spice Grill")).toEqual({ kind: "google_accepted", restaurant: "Ember & Spice Grill" });
  });
});

describe("drawing the Google and tone cards", () => {
  const sources: CardSources = {
    restaurant: { name: "Ember Grill" },
    state: {},
    setup: { managerEmail: "manager@dinerai.co.uk", googleConnectHref: null, tones: TONES },
  };
  const dina = (part: unknown) => chatMessage({ id: "11111111-1111-4111-8111-111111111111", role: "dina", body: "Here you go.", parts: [part] }, sources);
  const wa = { skippable: true, chatUrl: "https://app.test/onboarding/chat", appUrl: "https://app.test" };

  test("web: the steps card with its two buttons; connect only when Path A is on; the forward card", () => {
    expect(dina({ type: "google_steps", device: "laptop" }).component).toMatchObject({
      type: "steps",
      steps: [{ n: 1 }, { n: 2 }, { n: 3, copy: "manager@dinerai.co.uk" }, { n: 4 }],
      note: REASSURANCE,
      actions: [{ id: "invited", label: "Done, I've invited you" }, { id: "email_steps", label: "Email me these steps" }],
    });
    expect(dina({ type: "google_connect" }).component).toBeNull();
    const on = chatMessage({ id: "x", role: "dina", body: "Connect it.", parts: [{ type: "google_connect" }] }, { ...sources, setup: { ...sources.setup!, googleConnectHref: "/settings/google?r=1&back=onboarding" } });
    expect(on.component).toEqual({ type: "link", label: "Connect Google", href: "/settings/google?r=1&back=onboarding", hint: "Use the Google account you manage your profile with." });
    expect(dina({ type: "google_forward" }).component).toMatchObject({ type: "forward", text: expect.stringContaining("Ember Grill") });
  });

  test("WhatsApp: each step on its own with its screenshot, the email to copy, then the two buttons", () => {
    const out = renderForWhatsApp([dina({ type: "google_steps", device: "phone" })], wa);
    expect(out.slice(1, 5).map((o) => o.kind === "text" && o.mediaUrl)).toEqual([1, 2, 3, 4].map((n) => `https://app.test/onboarding/google/phone-${n}.png`));
    expect(out[5]).toEqual({ kind: "text", body: "manager@dinerai.co.uk" });
    expect(out[6]).toMatchObject({ kind: "buttons", options: [{ title: "Done, invited you" }, { title: "Email me the steps" }, { title: "Skip for now" }] });
  });

  test("tone cards: the review first (marked typical), one card per message, then a list; every label fits", () => {
    const web = dina({ type: "tone_choices", voice: "complaint" }).component;
    expect(web).toMatchObject({ type: "choice_cards", quote: { author: "James", rating: 2, real: false }, cards: [{ id: "warm" }, { id: "polished" }, { id: "fun" }, { id: "short" }, { id: "own" }] });
    const out = renderForWhatsApp([dina({ type: "tone_choices", voice: "praise" })], wa);
    expect(out[1].body).toMatch(/^\*Sarah\* ★★★★★\n"Came for my sister's birthday[\s\S]*_A typical review, to set your tone\._$/);
    expect(out.at(-1)).toMatchObject({ kind: "list" });
    const pick = out.at(-1)!;
    expect(pick.kind === "list" && pick.options.map((o) => o.title)).toEqual(["Warm and personal", "Polished", "Fun and chatty", "Short and simple", "Write my own", "Skip for now"]);
  });

  test("the offer to queue replies is two fixed buttons; the forward message goes on its own", () => {
    expect(dina({ type: "queue_replies" }).component).toEqual({ type: "quick_replies", options: [{ id: "queue_yes", label: "Queue my replies" }, { id: "queue_no", label: "No thanks" }] });
    const out = renderForWhatsApp([dina({ type: "google_forward" })], { ...wa, skippable: false });
    expect(out.map((o) => o.body)).toEqual(["Here you go.\n\nForward this to whoever set up your Google profile:", forwardMessage("Ember Grill", "manager@dinerai.co.uk")]);
  });
});

// ---------- Whole turns, on the in-memory database ----------

const R = "dddddddd-0000-4000-8000-0000000000f1";
let db: ReturnType<typeof memoryDb>;
const callDina = vi.fn();
const sentEmails: { subject: string; to: string | null }[] = [];
const sentWhatsApp: string[] = [];
const createDraft = vi.fn();
const writeReplies = vi.fn();
const usage = { purpose: "turn", model: "claude-sonnet-5-5", tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.003 } };
const answer = (messages: { text: string; component?: unknown }[], extra: Record<string, unknown> = {}) => ({
  reply: { messages: messages.map((m) => ({ component: null, ...m })), ...extra },
  calls: [usage],
  toolCalls: [],
  attempts: 1,
});
const tick = () => new Promise((r) => setTimeout(r, 3));

beforeEach(() => {
  vi.resetModules();
  sentEmails.length = 0;
  sentWhatsApp.length = 0;
  callDina.mockReset();
  createDraft.mockReset();
  writeReplies.mockReset();
  process.env.GOOGLE_MANAGER_EMAIL = "manager@dinerai.co.uk";
  db = memoryDb(
    {
      restaurants: [
        { id: R, name: "Ember Grill", slug: "ember-grill", owner_name: "Amina Khan", owner_email: "amina@example.org", owner_whatsapp: "whatsapp:+447700900123", whatsapp_from: "whatsapp:+14155238886", active: false, is_demo: true, address: "12 High St, London E1 6AN", cuisine: null, menu: [], profile_version: 0, brand_voice: null, profile_examples: null },
      ],
      onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "google", channel_last_used: "web", started_at: "2026-10-30T10:00:00.000Z", completed_at: null }],
      onboarding_steps: [{ restaurant_id: R, step_key: "hello", status: "done", data: {}, completed_at: "2026-10-30T10:05:00.000Z" }],
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      reviews: [],
      messages: [],
      google_connections: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "sent" }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, fields),
  }));
  vi.doMock("@/lib/onboarding/dina/call", async (orig) => ({ ...(await orig<object>()), callDina, routeStep: async () => ({ step: null, call: usage }) }));
  vi.doMock("@/lib/email", () => ({ sendOwnerEmail: async (r: { owner_email: string }, e: { subject: string }) => (sentEmails.push({ subject: e.subject, to: r.owner_email }), { delivery: "email", id: "e1", to: r.owner_email, redirectedFrom: null }) }));
  vi.doMock("@/lib/whatsapp", () => ({
    sendText: async (_f: string, _t: string, body: string) => (sentWhatsApp.push(body), { sid: "SM1", body }),
    sendImage: async (_f: string, _t: string, _u: string, body: string) => (sentWhatsApp.push(body), { sid: "SM2", body }),
    sendDinaChoices: async (_f: string, _t: string, m: { body: string }) => (sentWhatsApp.push(m.body), { sid: "SM3", body: m.body, usedButtons: true }),
  }));
  vi.doMock("@/lib/claude", async (orig) => ({ ...(await orig<object>()), claude: () => ({ beta: { messages: { parse: writeReplies } } }) }));
  vi.doMock("@/lib/assistant", () => ({ loadRestaurantContext: async () => ({ restaurantId: R }) }));
  vi.doMock("@/lib/checks", () => ({ checkDraft: async (_c: unknown, d: { content: string }) => ({ content: d.content, checks: { ok: true } }) }));
  vi.doMock("@/lib/drafts", async (orig) => ({ ...(await orig<object>()), createDraft }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/ops/menu", "@/lib/onboarding/dina/call", "@/lib/email", "@/lib/whatsapp", "@/lib/claude", "@/lib/assistant", "@/lib/checks", "@/lib/drafts"]) vi.doUnmock(m);
  delete process.env.GOOGLE_MANAGER_EMAIL;
});

const step = (key: string) => db.tables.onboarding_steps.find((s) => s.step_key === key);
const turn = async (text: string, extra: Record<string, unknown> = {}) => {
  const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
  const out = await dinaTurn({ restaurantId: R, channel: "web", event: "message", text, externalId: `c${Math.random()}`, ...extra });
  await tick();
  return out;
};
// A Dina message with a card, as if she'd shown it.
const shown = (part: unknown) => {
  const id = `aaaaaaaa-0000-4000-8000-${String(db.tables.onboarding_messages.length).padStart(12, "0")}`;
  db.tables.onboarding_messages.push({ id, restaurant_id: R, role: "dina", channel: "web", body: "Here you go.", parts: [part], created_at: new Date().toISOString() });
  return id;
};

describe("the Google step, whole turns", () => {
  test("'No' to having a profile: Dina's note skips the step and keeps it as a setup gap", async () => {
    callDina.mockResolvedValueOnce(answer([{ text: "No problem, we can do this later." }], { google_notes: { has_profile: "no" } }));
    await turn("No we don't have one");
    expect(step("google")).toMatchObject({ status: "skipped", data: { answers: { has_profile: "no" } } });
    expect(db.tables.setup_gaps).toEqual([expect.objectContaining({ step_key: "google" })]);
    expect(db.tables.onboarding_sessions[0].current_step).toBe("tone");
  });

  test("not an owner on it: waiting on whoever is (Dina moves on); a device answer records when the steps were shown", async () => {
    callDina.mockResolvedValueOnce(answer([{ text: "Only owners can add people. Here's a message to forward.", component: { type: "google_forward" } }], { google_notes: { has_profile: "yes", is_owner: "no" } }));
    await turn("I'm not the owner on it");
    expect(step("google")).toMatchObject({ status: "in_progress", waiting_on: "profile_owner" });
    expect(db.tables.onboarding_sessions[0].current_step).toBe("tone");

    db.tables.onboarding_steps = db.tables.onboarding_steps.filter((s) => s.step_key !== "google");
    db.tables.onboarding_sessions[0].current_step = "google";
    callDina.mockResolvedValueOnce(answer([{ text: "Here are the steps.", component: { type: "google_steps", device: "laptop" } }], { google_notes: { device: "laptop" } }));
    await turn("I'm on my laptop");
    expect(step("google")).toMatchObject({ status: "in_progress", data: { answers: { device: "laptop" }, steps_shown_at: expect.any(String) } });
  });

  test("'Done, I've invited you' in dummy mode: Google's acceptance is simulated, with the reviews and rating, and Dina is told the words", async () => {
    db.tables.reviews.push({ id: "r1", restaurant_id: R, rating: 5, review_date: "2026-10-01" }, { id: "r2", restaurant_id: R, rating: 4, review_date: "2026-10-02" });
    const msg = shown({ type: "google_steps", device: "phone" });
    const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
    const note = await handleAnswer({ restaurantId: R, messageId: msg, choiceId: "invited", channel: "web" });
    expect(note).toMatch(/simulated[\s\S]*"I'm in! You have 2 reviews and a 4\.5 rating\. Google makes new managers wait 7 days/);
    expect(step("google")).toMatchObject({ status: "done", data: { accepted_by: "simulated", reviews: { count: 2, average: 4.5 }, invited_at: expect.any(String) } });
  });

  test("'Email me these steps': the steps go to the owner, and a repeat of the same tap does nothing twice", async () => {
    const msg = shown({ type: "google_steps", device: "phone" });
    const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
    const note = await handleAnswer({ restaurantId: R, messageId: msg, choiceId: "email_steps", channel: "web", externalId: "tap-1" });
    expect(note).toMatch(/emailed the owner these steps/);
    expect(sentEmails).toEqual([{ subject: "Your steps: adding DinerAI to Ember Grill's Google profile", to: "amina@example.org" }]);
    db.tables.onboarding_messages.push({ id: "bbbbbbbb-0000-4000-8000-000000000001", restaurant_id: R, role: "owner", channel: "web", body: "Email me these steps", parts: [], external_id: "tap-1", created_at: new Date().toISOString() });
    expect(await handleAnswer({ restaurantId: R, messageId: msg, choiceId: "email_steps", channel: "web", externalId: "tap-1" })).toBeNull();
    expect(sentEmails).toHaveLength(1);
  });

  test("the builder marks Google accepted: done, and Dina says so in the chat (and on WhatsApp inside its window)", async () => {
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "google", status: "in_progress", waiting_on: "google", data: { invited_at: "2026-10-30T10:00:00Z" } });
    db.tables.messages.push({ restaurant_id: R, direction: "inbound", from_number: "whatsapp:+447700900123", body: "hi", created_at: new Date().toISOString() });
    const { handleBuilderCommand } = await import("@/lib/feeds/builder");
    expect(await handleBuilderCommand("BUILDER GOOGLE ACCEPTED ember-grill")).toMatch(/^✅ Ember Grill: Google step done\. Dina told the owner: "I'm in! Your profile has no reviews yet/);
    expect(step("google")).toMatchObject({ status: "done", data: { accepted_by: "builder" } });
    expect(db.tables.onboarding_messages.at(-1)).toMatchObject({ role: "dina", channel: "whatsapp", body: expect.stringMatching(/^I'm in!/) });
    expect(sentWhatsApp).toEqual([expect.stringMatching(/^I'm in!/)]);
  });

  test("the 24-hour nudge: once, by email with the steps when WhatsApp's window is shut; never for a running restaurant", async () => {
    const dayAgo = new Date(Date.now() - 25 * 3_600_000).toISOString();
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "google", status: "in_progress", waiting_on: null, data: { answers: { device: "phone" }, steps_shown_at: dayAgo } });
    const { runGoogleNudges } = await import("@/lib/onboarding/dina/google-step");
    expect(await runGoogleNudges()).toEqual([{ restaurant: R, sent: "email" }]);
    expect(sentEmails).toEqual([{ subject: "Adding DinerAI to Ember Grill's Google profile", to: "amina@example.org" }]);
    expect(db.tables.onboarding_messages.at(-1)).toMatchObject({ role: "dina", channel: "web", body: NUDGE_TEXT });
    expect(await runGoogleNudges()).toEqual([]); // once only
    expect(step("google")?.data).toMatchObject({ nudged_at: expect.any(String), nudge_reason: "not_invited" });

    step("google")!.data = { steps_shown_at: dayAgo };
    db.tables.restaurants[0].active = true;
    expect(await runGoogleNudges()).toEqual([]);
  });
});

describe("the tone step, whole turns", () => {
  beforeEach(() => {
    db.tables.onboarding_sessions[0].current_step = "tone";
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "google", status: "skipped", data: {}, skipped_at: "2026-10-30T10:06:00.000Z" });
  });

  test("no real reviews: the typical ones; a tap on each saves the two voices, the brand voice, and finishes the step", async () => {
    callDina.mockResolvedValueOnce(answer([{ text: "Here's a typical review so we can set your tone.", component: { type: "tone_choices", voice: "praise" } }]));
    await turn("ok let's do tone");
    expect(writeReplies).not.toHaveBeenCalled(); // nothing real to write for
    expect(step("tone")?.data.options).toMatchObject({ praise: { real: false, review: { author: "Sarah" } }, complaint: { real: false } });

    const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
    const praise = shown({ type: "tone_choices", voice: "praise" });
    expect(await handleAnswer({ restaurantId: R, messageId: praise, choiceId: "warm", channel: "web" })).toMatch(/saved the praise voice: Warm and personal\. Now the complaint review/);
    const complaint = shown({ type: "tone_choices", voice: "complaint" });
    expect(await handleAnswer({ restaurantId: R, messageId: complaint, choiceId: "short", channel: "web" })).toMatch(/Both voices are set, so the tone step is done\.$/);
    const r = db.tables.restaurants[0];
    expect(r.profile_examples).toMatchObject({ review_replies: { positive: { style: "Warm and personal", own: false }, negative: { style: "Short and simple", reply: expect.stringMatching(/^Sorry James, that wait/) } } });
    expect(r.brand_voice).toMatch(/^Warm and personal:/);
    expect(step("tone")?.status).toBe("done");
  });

  test("'Write my own': Dina is asked to get their words; save_tone keeps them exactly", async () => {
    const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
    const praise = shown({ type: "tone_choices", voice: "praise" });
    expect(await handleAnswer({ restaurantId: R, messageId: praise, choiceId: "own", channel: "web" })).toMatch(/write their own reply to the good review/);
    const { runTool, TOOLS } = await import("@/lib/onboarding/dina/tools");
    const saved = await runTool({ restaurantId: R, channel: "web" }, TOOLS, "save_tone", { voice: "praise", own_reply: "Cheers Sarah, so glad the birthday was a good one. See you soon!" });
    expect(saved).toMatchObject({ ok: true, text: expect.stringMatching(/saved the praise voice: their own words/) });
    expect(db.tables.restaurants[0].profile_examples.review_replies.positive).toMatchObject({ own: true, reply: "Cheers Sarah, so glad the birthday was a good one. See you soon!" });
    expect(await runTool({ restaurantId: R, channel: "web" }, TOOLS, "save_tone", { voice: "complaint", own_reply: "ok" })).toMatchObject({ ok: false });
  });

  test("skipped: Warm and personal for both, marked as a default", async () => {
    const { skipStep } = await import("@/lib/onboarding/sessions");
    const { afterSkip } = await import("@/lib/onboarding/dina/answers");
    await skipStep(R, "tone");
    await afterSkip(R, "tone");
    expect(db.tables.restaurants[0].profile_examples.review_replies).toMatchObject({ positive: { style: "Warm and personal" }, negative: { style: "Warm and personal" } });
    expect(db.tables.restaurants[0].brand_voice).toMatch(/^Warm and personal/);
    expect(step("tone")?.data).toMatchObject({ defaulted: true });
  });

  test("real reviews: replies written for them (one Claude call), then queued as checked, held drafts for approval", async () => {
    const long = (s: string) => `${s} ${"and it was all really lovely ".repeat(3)}`.trim();
    db.tables.reviews.push(
      { id: "good", restaurant_id: R, author_name: "Priya", rating: 5, text: long("The lamb chops were amazing and our waiter Sam was brilliant."), review_date: "2026-10-01", replied: false, reply_text: null },
      { id: "bad", restaurant_id: R, author_name: "Tom", rating: 2, text: long("We waited forty minutes for mains and the chips were cold."), review_date: "2026-10-02", replied: false, reply_text: null },
    );
    const four = (who: string) => ({ warm: `${who}, thank you so much for coming in!`, polished: `Dear ${who}, thank you for your review.`, fun: `${who}, you made our day!`, short: `Thanks ${who}!` });
    writeReplies.mockResolvedValueOnce({ model: "claude-sonnet-5-5", usage: { input_tokens: 800, output_tokens: 300 }, parsed_output: { praise: four("Priya"), complaint: four("Tom") } });
    const { prepareToneOptions } = await import("@/lib/onboarding/dina/tone-step");
    await prepareToneOptions(R);
    expect(writeReplies).toHaveBeenCalledTimes(1);
    expect(writeReplies.mock.calls[0][0].messages[0].content).toMatch(/<review voice="praise" stars="5" author="Priya">[\s\S]*<review voice="complaint" stars="2" author="Tom">/);
    expect(step("tone")?.data.options).toMatchObject({ praise: { real: true, review: { id: "good" }, replies: { warm: "Priya, thank you so much for coming in!" } } });
    expect(db.tables.onboarding_ai_usage).toEqual([expect.objectContaining({ purpose: "extract", step_key: "tone" })]);

    const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
    await handleAnswer({ restaurantId: R, messageId: shown({ type: "tone_choices", voice: "praise" }), choiceId: "fun", channel: "web" });
    expect(await handleAnswer({ restaurantId: R, messageId: shown({ type: "tone_choices", voice: "complaint" }), choiceId: "polished", channel: "web" })).toMatch(/real Google reviews: offer to queue/);
    expect(await handleAnswer({ restaurantId: R, messageId: shown({ type: "queue_replies" }), choiceId: "queue_yes", channel: "web" })).toMatch(/queued 2 replies/);
    expect(createDraft.mock.calls.map((c) => [c[0].kind, c[0].reviewId, c[0].mode, c[0].content])).toEqual([
      ["review_reply", "good", "hold", "Priya, you made our day!"],
      ["review_reply", "bad", "hold", "Dear Tom, thank you for your review."],
    ]);
    expect(db.tables.reviews.every((r) => r.handled_at)).toBe(true);
    expect(await handleAnswer({ restaurantId: R, messageId: shown({ type: "queue_replies" }), choiceId: "queue_yes", channel: "web" })).toMatch(/already queued/);
    expect(createDraft).toHaveBeenCalledTimes(2);
  });

  test("a written reply that fails the checks: that review falls back to the typical one", async () => {
    db.tables.reviews.push({ id: "good", restaurant_id: R, author_name: "Priya", rating: 5, text: "The lamb chops were amazing and our waiter Sam was brilliant, we will come back again very soon", review_date: "2026-10-01", replied: false, reply_text: null });
    writeReplies.mockResolvedValueOnce({ model: "claude-sonnet-5-5", usage: {}, parsed_output: { praise: { warm: "Priya — thank you!", polished: "Dear Priya, thank you.", fun: "Woo, thanks Priya!", short: "Thanks Priya!" }, complaint: null } });
    const { prepareToneOptions } = await import("@/lib/onboarding/dina/tone-step");
    await prepareToneOptions(R);
    expect(step("tone")?.data.options).toMatchObject({ praise: { real: false, review: { author: "Sarah" } }, complaint: { real: false } });
  });
});

describe("notes only count on their own open step", () => {
  test("Google notes repeated after Google is done don't put the owner back on Google", async () => {
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "google", status: "done", data: { accepted_by: "simulated" }, completed_at: new Date().toISOString() });
    db.tables.onboarding_sessions[0].current_step = "tone";
    callDina.mockResolvedValueOnce(answer([{ text: "Next, your tone.", component: { type: "tone_choices", voice: "praise" } }], { google_notes: { device: "laptop" } }));
    await turn("ok");
    expect(db.tables.onboarding_sessions[0].current_step).toBe("tone");
    expect(step("google")?.data).not.toHaveProperty("answers");
  });

  test("Hello notes in the same reply that saved Hello don't reopen it", async () => {
    db.tables.onboarding_steps = [];
    db.tables.onboarding_sessions[0].current_step = "hello";
    callDina.mockImplementationOnce(async () => {
      const { completeStep } = await import("@/lib/onboarding/sessions");
      await completeStep(R, "hello", "done", { role: "owner" });
      return answer([{ text: "Saved. Next, Google." }], { hello_notes: { cuisine: "Halal grill" } });
    });
    await turn("Looks right");
    expect(step("hello")?.status).toBe("done");
    expect(db.tables.onboarding_sessions[0].current_step).toBe("google");
  });
});
