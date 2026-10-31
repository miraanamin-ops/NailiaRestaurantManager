import { z } from "zod";
import { STEP_DEFS, type FlowStepKey } from "../flow";

// What Dina says, and the plain-code checks every reply passes before anyone sees
// it (tests/dina.test.ts). No imports beyond zod and the step list, so it's
// unit-tested. A reply that fails gets one retry with the problems listed; if it
// fails again, the owner sees a fixed line from code instead (fallbackReply).

// Components the web chat draws and WhatsApp turns into buttons, lists or
// numbered text. Dina only names a card: what's in it (the menu, the hours) comes
// from the database, never from her words.
// Lengths are limits for dinaReplyProblems, not for the schema: a reply with one
// label a few characters too long goes back to Dina to fix, instead of failing the
// parse outright (the first browser run's opening turn did, 29 Oct).
export const LIMITS = { text: 600, label: 24, cardTitle: 40, cardBody: 500, uploadLabel: 40 } as const;

const Option = z.object({ id: z.string().min(1).max(40), label: z.string().min(1) });

export const Component = z.discriminatedUnion("type", [
  z.object({ type: z.literal("quick_replies"), options: z.array(Option).min(1).max(10) }),
  z.object({
    type: z.literal("choice_cards"),
    cards: z.array(z.object({ id: z.string().min(1).max(40), title: z.string().min(1), body: z.string().min(1) })).min(2).max(6),
  }),
  z.object({ type: z.literal("upload"), accept: z.enum(["photo", "document", "spreadsheet", "any"]), multiple: z.boolean(), label: z.string().min(1) }),
  z.object({ type: z.literal("editable_card"), card: z.enum(["basics", "menu", "hours", "faqs"]) }),
  z.object({ type: z.literal("summary") }),
  // Step 2 (Google): code fills these from google-content.ts.
  z.object({ type: z.literal("google_steps"), device: z.enum(["phone", "laptop"]) }),
  z.object({ type: z.literal("google_forward") }),
  z.object({ type: z.literal("google_connect") }),
  // Step 3 (tone): one review and a reply in each tone (code: tones.ts), and the
  // offer to queue the owner's picked replies to their real reviews.
  z.object({ type: z.literal("tone_choices"), voice: z.enum(["praise", "complaint"]) }),
  z.object({ type: z.literal("queue_replies") }),
  // Step 5: the next dish's suggested allergens to check (code picks the dish).
  // (dish: set by code when the card is saved, whatever she sends.)
  z.object({ type: z.literal("allergen_check"), dish: z.string().optional() }),
]);
export type Component = z.infer<typeof Component>;

export const DinaMessage = z.object({
  text: z.string().min(1),
  component: Component.nullable(),
});
export type DinaMessage = z.infer<typeof DinaMessage>;

// hello_notes: what the owner just told her of the Hello basics, noted with her
// reply instead of through a tool call (a tool call costs a second Claude call,
// about 1.5 to 2 seconds). Code checks it with note_hello's rules and keeps it as
// a draft for the basics card (turn.ts); nothing is saved for real until save_hello.
const helloShape = { owner_name: z.string(), restaurant_name: z.string(), address: z.string(), cuisine: z.string(), role: z.enum(["owner", "manager"]) };
export const HelloNotes = z.object(helloShape).partial();

// google_notes: the owner's answers to the Google step's three questions, the same way.
const googleShape = { has_profile: z.enum(["yes", "no", "not_sure"]), is_owner: z.enum(["yes", "no", "not_sure"]), device: z.enum(["phone", "laptop"]) };
export const GoogleNotes = z.object(googleShape).partial();

// Step 6: hours the owner just told her, by day ("Monday": "12-10pm" or "closed"),
// and their answers to the common questions, by topic, in their own words.
// (Named days, not an open record: the first real run left an open record empty.)
const hoursShape = { Monday: z.string(), Tuesday: z.string(), Wednesday: z.string(), Thursday: z.string(), Friday: z.string(), Saturday: z.string(), Sunday: z.string() };
export const HoursNotes = z.object(hoursShape).partial();
const faqShape = { halal: z.string(), parking: z.string(), delivery: z.string(), bookings: z.string(), accessibility: z.string(), kids: z.string(), private_hire: z.string() };
export const FaqNotes = z.object(faqShape).partial();

export const DinaReply = z.object({
  messages: z.array(DinaMessage).min(1).max(3),
  hello_notes: HelloNotes.nullable().optional(),
  google_notes: GoogleNotes.nullable().optional(),
  hours_notes: HoursNotes.nullable().optional(),
  faq_notes: FaqNotes.nullable().optional(),
});
export type DinaReply = z.infer<typeof DinaReply>;

// ---------- What Claude is asked for ----------
// The API limits an answer shape to 24 optional fields and 16 "this or null"
// fields (the first real runs of steps 4 to 6 hit both, 31 Oct). So her notes go
// as one list of { field, value } pairs ("hours.Monday": "12-10pm"): no optional
// or nullable fields however many notes there are. fromWire turns the list back
// into the notes above, keeping only values each note allows.

const NOTE_FIELDS = [
  ...Object.keys(helloShape).map((k) => `hello.${k}`),
  ...Object.keys(googleShape).map((k) => `google.${k}`),
  ...Object.keys(hoursShape).map((k) => `hours.${k}`),
  ...Object.keys(faqShape).map((k) => `faq.${k}`),
] as [string, ...string[]];

const WireComponent = z.discriminatedUnion("type", [
  ...Component.options.filter((o) => o.shape.type.value !== "allergen_check"),
  z.object({ type: z.literal("allergen_check") }),
] as unknown as [z.ZodObject<{ type: z.ZodLiteral<string> }>, ...z.ZodObject<{ type: z.ZodLiteral<string> }>[]]);

export const DinaReplyWire = z.object({
  messages: z.array(z.object({ text: z.string().min(1), component: WireComponent.nullable() })).min(1).max(3),
  notes: z.array(z.object({ field: z.enum(NOTE_FIELDS), value: z.string() })).max(30),
});

const GROUPS = { hello: HelloNotes, google: GoogleNotes, hours: HoursNotes, faq: FaqNotes } as const;

export function fromWire(w: { messages: unknown[]; notes?: { field: string; value: string }[] | null }): DinaReply {
  const grouped: Record<keyof typeof GROUPS, Record<string, string>> = { hello: {}, google: {}, hours: {}, faq: {} };
  for (const n of w.notes ?? []) {
    const [group, key] = n.field.split(".") as [keyof typeof GROUPS, string];
    const value = n.value?.trim();
    if (group in GROUPS && key && value) grouped[group][key] = value;
  }
  // Each group checked as a whole; a value the note doesn't allow (a role of "boss") is dropped.
  const keep = <G extends keyof typeof GROUPS>(g: G) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(grouped[g])) if (GROUPS[g].safeParse({ [k]: v }).success) out[k] = v;
    return Object.keys(out).length ? out : null;
  };
  return {
    messages: w.messages as DinaReply["messages"],
    hello_notes: keep("hello") as DinaReply["hello_notes"],
    google_notes: keep("google") as DinaReply["google_notes"],
    hours_notes: keep("hours") as DinaReply["hours_notes"],
    faq_notes: keep("faq") as DinaReply["faq_notes"],
  };
}

// Every piece of text the owner would see: the messages and every label.
export function visibleText(reply: DinaReply) {
  return reply.messages.flatMap((m) => [
    m.text,
    ...(m.component?.type === "quick_replies" ? m.component.options.map((o) => o.label) : []),
    ...(m.component?.type === "choice_cards" ? m.component.cards.flatMap((c) => [c.title, c.body]) : []),
    ...(m.component?.type === "upload" ? [m.component.label] : []),
  ]);
}

// Claiming to be a person, or not to be an AI; and things only a person could do.
// (She doesn't announce she's an AI, but never denies it: decided 30 Oct.)
const PERSON_CLAIMS: RegExp[] = [
  /\bI(?:'|’)?m\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+)?(?:human|person|man|woman|lady|guy)\b/i,
  /\bI\s+am\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+)?(?:human|person|man|woman|lady|guy)\b/i,
  /\b(?:I(?:'|’)?m|I\s+am)\s+not\s+(?:a\s+|an\s+)?(?:bot|robot|AI|A\.I\.|machine|computer|chatbot|program|assistant)\b/i,
  /\b(?:I(?:'|’)?m|I\s+am)\s+(?:a\s+)?(?:member\s+of\s+(?:the\s+)?(?:staff|team)|real\s+manager|human\s+manager)\b/i,
  /\bas\s+a\s+(?:human|person)\b/i,
  /\bI(?:\s+will|(?:'|’)ll)\s+(?:(?:call|phone|ring)\s+(?:you|them|the\s+restaurant|your)|visit|pop\s+(?:in|round|by)|come\s+(?:in|round|by))\b/i,
  /\bI\s+(?:tasted|ate|visited|went\s+to|have\s+been\s+to|(?:'|’)ve\s+been\s+to)\b/i,
];

// Quoted text (a review she's showing) doesn't count towards her own questions.
const withoutQuotes = (t: string) => t.replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, "");

export function dinaReplyProblems(reply: DinaReply): string[] {
  const problems: string[] = [];
  const texts = visibleText(reply);
  if (texts.some((t) => t.includes("—"))) problems.push("It has an em-dash (—). Never use em-dashes: use a comma, a full stop or 'and'.");
  if (texts.some((t) => / – /.test(t))) problems.push("It uses an en-dash (–) as a dash. Use a comma or a full stop instead.");
  for (const t of texts) {
    const claim = PERSON_CLAIMS.find((re) => re.test(t));
    if (claim) {
      problems.push(`It reads as if Dina were a person ("${t.match(claim)![0]}"). Dina is an AI and must never say or suggest otherwise.`);
      break;
    }
  }
  const questions = reply.messages.reduce((n, m) => n + (withoutQuotes(m.text).match(/\?/g) ?? []).length, 0);
  if (questions > 1) problems.push(`It asks ${questions} questions. Ask one question at a time.`);
  const long = reply.messages.find((m) => m.text.length > LIMITS.text);
  if (long) problems.push(`A message is ${long.text.length} characters. Keep each message under ${LIMITS.text}.`);
  const tooLong = (what: string, text: string, max: number) => {
    if (text.length > max) problems.push(`The ${what} "${text}" is ${text.length} characters; the most is ${max}. Make it shorter.`);
  };
  for (const { component: c } of reply.messages) {
    if (c?.type === "quick_replies") c.options.forEach((o) => tooLong("button label", o.label, LIMITS.label));
    if (c?.type === "choice_cards")
      c.cards.forEach((card) => {
        tooLong("card title", card.title, LIMITS.cardTitle);
        tooLong("card text", card.body, LIMITS.cardBody);
      });
    if (c?.type === "upload") tooLong("upload label", c.label, LIMITS.uploadLabel);
  }
  return problems;
}

// Saying something is saved when nothing was (the first real run of steps 4 to 6:
// "I've noted you... with 020 7946 0000", and the number wasn't saved). A claim like
// this needs a tool that saved something this turn, notes in the reply (code saves
// those), or code having acted for her (a tap, told under "Also").
const SAVED_CLAIM = /\b(that'?s saved|(i'?ve|i have) (saved|noted|recorded|updated|got that (saved|down))|(all|now) saved|saved (it|that|those|them|your)|noted (that|it|you|those|down)|that'?s (everything|all) i need)\b/i;

export function unsavedClaim(reply: DinaReply, saved: { toolSaved: boolean; codeActed: boolean }) {
  if (saved.toolSaved || saved.codeActed) return null;
  const notes = [reply.hello_notes, reply.google_notes, reply.hours_notes, reply.faq_notes].some((n) => n && Object.values(n).some(Boolean));
  if (notes) return null;
  const said = reply.messages.map((m) => m.text).join(" ").match(SAVED_CLAIM);
  return said ? `It says "${said[0]}", but nothing was saved this turn. Call the step's tool with what the owner told you, or don't say it's saved.` : null;
}

// When a reply can't be made to pass (or Claude can't be reached): plain words
// from code, so the owner is never left without an answer or shown something unchecked.
// Arriving (start) or coming back (resume) gets a proper hello, never an apology
// for something the owner didn't say.
export type FallbackContext = { event?: "start" | "message" | "resume" | "action"; ownerName?: string | null; restaurantName?: string | null };

export function fallbackReply(step: FlowStepKey | null, ctx: FallbackContext = {}): DinaReply {
  if (!step) return { messages: [{ text: "That's everything for setup. You can change any answer by telling me.", component: null }] };
  const def = STEP_DEFS[step];
  const first = ctx.ownerName?.trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first}` : "Hi";
  if (ctx.event === "start" && step === "hello") {
    const place = ctx.restaurantName?.trim() || "your restaurant";
    return {
      messages: [
        { text: `${hi}, I'm Dina, your DinerAI manager. I'll get ${place} set up with you, and it takes about 20 minutes.`, component: null },
        { text: "To start, are you the owner or the manager?", component: { type: "quick_replies", options: [{ id: "owner", label: "Owner" }, { id: "manager", label: "Manager" }] } },
      ],
    };
  }
  if (ctx.event === "start" || ctx.event === "resume") {
    const skip = def.skippable ? { type: "quick_replies" as const, options: [{ id: "carry_on", label: "Carry on" }, { id: "skip", label: "Skip for now" }] } : null;
    const opener = ctx.event === "resume" ? "Welcome back" : hi;
    return { messages: [{ text: `${opener}, it's Dina. Let's carry on with ${def.title.toLowerCase()}.${def.unlock ? ` ${def.unlock}` : ""}`, component: skip }] };
  }
  return {
    messages: [
      {
        text: `Sorry, I didn't quite manage that. Let's carry on with ${def.title.toLowerCase()}.${def.unlock ? ` ${def.unlock}` : ""} Could you tell me again?`,
        component: def.skippable ? { type: "quick_replies", options: [{ id: "skip", label: "Skip for now" }] } : null,
      },
    ],
  };
}

// Plain text of a reply, for logs and the WhatsApp fallback.
export const replyText = (reply: DinaReply) => reply.messages.map((m) => m.text).join("\n\n");
