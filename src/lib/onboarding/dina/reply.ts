import { z } from "zod";
import { STEP_DEFS, type FlowStepKey } from "../flow";

// What Dina says, and the plain-code checks every reply passes before anyone sees
// it (tests/dina.test.ts). No imports beyond zod and the step list, so it's
// unit-tested. A reply that fails gets one retry with the problems listed; if it
// fails again, the owner sees a fixed line from code instead (fallbackReply).

// Components the web chat draws and WhatsApp turns into buttons, lists or
// numbered text. Dina only names a card: what's in it (the menu, the hours) comes
// from the database, never from her words.
const Option = z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(24) });

export const Component = z.discriminatedUnion("type", [
  z.object({ type: z.literal("quick_replies"), options: z.array(Option).min(1).max(10) }),
  z.object({
    type: z.literal("choice_cards"),
    cards: z.array(z.object({ id: z.string().min(1).max(40), title: z.string().min(1).max(40), body: z.string().min(1).max(500) })).min(2).max(6),
  }),
  z.object({ type: z.literal("upload"), accept: z.enum(["photo", "document", "spreadsheet", "any"]), multiple: z.boolean(), label: z.string().min(1).max(40) }),
  z.object({ type: z.literal("editable_card"), card: z.enum(["basics", "menu", "hours", "faqs"]) }),
  z.object({ type: z.literal("summary") }),
]);
export type Component = z.infer<typeof Component>;

export const DinaMessage = z.object({
  text: z.string().min(1).max(700),
  component: Component.nullable(),
});
export type DinaMessage = z.infer<typeof DinaMessage>;

export const DinaReply = z.object({ messages: z.array(DinaMessage).min(1).max(3) });
export type DinaReply = z.infer<typeof DinaReply>;

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
  const long = reply.messages.find((m) => m.text.length > 600);
  if (long) problems.push(`A message is ${long.text.length} characters. Keep each message under 600.`);
  return problems;
}

// When a reply can't be made to pass (or Claude can't be reached): plain words
// from code, so the owner is never left without an answer or shown something unchecked.
export function fallbackReply(step: FlowStepKey | null): DinaReply {
  if (!step) return { messages: [{ text: "That's everything for setup. You can change any answer by telling me.", component: null }] };
  const def = STEP_DEFS[step];
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
