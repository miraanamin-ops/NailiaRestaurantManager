import "server-only";
import { withAiContext } from "@/lib/ai-context";
import { z } from "zod";
import { FlowError, isFlowStep, STEP_DEFS } from "@/lib/onboarding/flow";
import { afterSkip, answeredPart, handleAnswer } from "@/lib/onboarding/dina/answers";
import { chatSources } from "@/lib/onboarding/dina/chat";
import type { DinaReply } from "@/lib/onboarding/dina/reply";
import { codeTurn, dinaTurn, type TurnInput } from "@/lib/onboarding/dina/turn";
import { cardFor, chatMessage, confirmText, factsFromSources, progressFrom, skippableNow } from "@/lib/onboarding/dina/view";
import { enterStep, skipStep } from "@/lib/onboarding/sessions";
import { limitKey, limitReached, MINUTE, recordAttempt } from "@/lib/rate-limit";
import { guideFiles, guidePick, guideSkipAsk, guideTyped } from "@/lib/onboarding/guide/handle";
import { getSupabase } from "@/lib/supabase";

// One owner action in the chat with Dina, for the website's chat
// (app/api/onboarding/chat, streamed) and the app's setup screen (app/api/app/setup,
// answered in one go). Events, in order:
//   {"type":"typing"}                 straight away
//   {"type":"status","text":"…"}      while one of her tools runs ("Saving your basics…")
//   {"type":"message","message":{…}}  each of her messages, already checked, one after another
//   {"type":"state","progress":{…},"skippable":true}
//   {"type":"done"}  or  {"type":"error","text":"…"}
// Dina's words are checked before they're shown (lib/onboarding/dina/reply.ts), so
// they arrive whole, message by message, never word by word.
// A repeated send (same clientId) is answered once; at most 120 of Dina's turns per
// restaurant per 10 minutes. Taps that code answers by itself (the allergen cards)
// cost nothing and don't count, so a long menu never runs into the limit.

export const Action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("message"), text: z.string().trim().min(1).max(2000), clientId: z.string().uuid() }),
  z.object({ kind: z.literal("answer"), messageId: z.string().uuid(), choiceId: z.string().min(1).max(40), label: z.string().min(1).max(60), clientId: z.string().uuid() }),
  // One of code's question cards, confirmed on the card (guide/handle.ts): what was picked, and any words typed in it.
  z.object({
    kind: z.literal("pick"),
    messageId: z.string().uuid(),
    choiceIds: z.array(z.string().min(1).max(200)).min(1).max(40),
    text: z.string().trim().max(600).optional(),
    label: z.string().min(1).max(200),
    // The allergen grid: each dish's ticks (allergens, and "diet:" tags), or "unsure".
    grid: z.record(z.string().max(200), z.union([z.array(z.string().max(60)).max(30), z.literal("unsure")])).optional(),
    // The staffing card: each role's minimum and "1 more per N orders an hour".
    staffing: z.record(z.string().max(40), z.object({ min: z.number().int().min(0).max(20), per: z.number().min(1).max(200).nullable() })).optional(),
    clientId: z.string().uuid(),
  }),
  z.object({ kind: z.literal("confirm"), messageId: z.string().uuid(), changes: z.record(z.string().max(40), z.string().max(300)), clientId: z.string().uuid() }),
  z.object({ kind: z.literal("skip"), clientId: z.string().uuid() }),
  z.object({ kind: z.literal("jump"), step: z.string(), clientId: z.string().uuid() }),
  // Files the browser has just put in the bucket (api/onboarding/upload).
  z.object({ kind: z.literal("files"), paths: z.array(z.string().max(200)).min(1).max(10), clientId: z.string().uuid() }),
]);
const Body = z.object({ r: z.string().uuid(), action: Action });

const MESSAGE_GAP_MS = 450;
const TURNS = { max: 120, windowMs: 10 * MINUTE };

export type ChatAction = z.infer<typeof Action>;
export type ChatEvent = { type: string; [k: string]: unknown };

export const parseChatBody = (body: unknown) => Body.safeParse(body);

// Too many of Dina's turns lately: answered before anything else.
export async function overTurnLimit(r: string, action: ChatAction) {
  return action.kind !== "start" && (await limitReached([{ key: limitKey("dina-turn", r), ...TURNS }]));
}

// gapMs: the pause between Dina's messages (the website shows them arriving one by one).
// Every Claude call it makes is counted against this restaurant (ai_usage).
export function runChatAction(r: string, action: ChatAction, send: (event: ChatEvent) => void, opts: { gapMs?: number } = {}) {
  return withAiContext({ restaurantId: r }, () => chatAction(r, action, send, opts));
}

async function chatAction(r: string, action: ChatAction, send: (event: ChatEvent) => void, { gapMs = MESSAGE_GAP_MS }: { gapMs?: number } = {}) {
  const limits = [{ key: limitKey("dina-turn", r), ...TURNS }];
  try {
    send({ type: "typing" });
    const input = await turnFor(r, action);
    if (!input) {
      send({ type: "done" });
      return;
    }
    // Only turns that go to Dina (a Claude call) use up the allowance.
    if (action.kind !== "start" && !input.codeReply) await recordAttempt(limits);
    // A tap code answers itself (the next allergen card): no Claude call.
    const result = input.codeReply
      ? await codeTurn({ restaurantId: r, channel: "web", text: input.text ?? "", externalId: input.externalId, ownerParts: input.ownerParts, messages: input.codeReply, note: input.note })
      : await dinaTurn({ ...input, restaurantId: r, channel: "web", onStatus: (text) => send({ type: "status", text }) });
    if (result.duplicate) {
      send({ type: "done" });
      return;
    }
    const sources = await chatSources(r);
    for (const [i, m] of result.messages.entries()) {
      if (i && gapMs) await new Promise((res) => setTimeout(res, gapMs));
      send({ type: "message", message: chatMessage({ id: m.id, role: "dina", body: m.text, parts: m.component ? [m.component] : [] }, sources) });
    }
    const focus = sources.focus?.current_step ?? null;
    send({ type: "state", progress: progressFrom(sources.state, focus, factsFromSources(sources)), skippable: skippableNow(focus) });
    send({ type: "done" });
  } catch (err) {
    console.error("The chat turn failed", err);
    send({ type: "error", text: err instanceof FlowError ? `${err.message}.` : "Sorry, something went wrong on my side. Please try again." });
  }
}

// What each tap or message means for Dina's turn. Skipping and jumping are done by
// code first (Dina is told what happened); everything else is the owner's answer.
type Turn = Omit<TurnInput, "restaurantId" | "channel"> & { codeReply?: DinaReply["messages"] };

async function turnFor(r: string, action: z.infer<typeof Action>): Promise<Turn | null> {
  switch (action.kind) {
    case "start": {
      // Only the very first time: a reload never makes her say hello twice.
      const { getSupabase } = await import("@/lib/supabase");
      const { count } = await getSupabase().from("onboarding_messages").select("id", { count: "exact", head: true }).eq("restaurant_id", r);
      return count ? null : { event: "start" };
    }
    case "message": {
      // Typed while one of code's cards is on screen: maybe its answer (guide).
      const typed = await guideTyped({ restaurantId: r, text: action.text, channel: "web", asking: await askingCard(r) });
      if (typed) return { event: "message", text: action.text, externalId: action.clientId, codeReply: typed.messages, note: typed.note ?? null };
      return { event: "message", text: action.text, externalId: action.clientId };
    }
    case "pick": {
      const g = await guidePick({ restaurantId: r, messageId: action.messageId, choiceIds: action.choiceIds, text: action.text ?? null, channel: "web", confirmed: true, grid: action.grid ?? null, staffing: action.staffing ?? null });
      if (!g) return null;
      return { event: "message", text: action.label, externalId: action.clientId, ownerParts: [{ type: "answer", to: action.messageId, choice: action.choiceIds.join(",") }], codeReply: g.messages, note: g.note ?? null };
    }
    case "answer": {
      // Code's own cards drawn as buttons (do this chapter later?, a pick read back).
      const g = await guidePick({ restaurantId: r, messageId: action.messageId, choiceIds: [action.choiceId], channel: "web", confirmed: false });
      if (g) return { event: "message", text: action.label, externalId: action.clientId, ownerParts: [{ type: "answer", to: action.messageId, choice: action.choiceId }], codeReply: g.messages, note: g.note ?? null };
      // Some taps are acted on by code first (Google's buttons, a tone): Dina is told what happened.
      const outcome = await handleAnswer({ restaurantId: r, messageId: action.messageId, choiceId: action.choiceId, channel: "web", externalId: action.clientId });
      const turn: Turn = { event: "message", text: action.label, externalId: action.clientId, ownerParts: [{ type: "answer", to: action.messageId, choice: action.choiceId }] };
      return outcome && typeof outcome === "object" ? { ...turn, codeReply: outcome.reply } : { ...turn, note: outcome };
    }
    case "confirm": {
      // "Looks right" as it is: code saves the hours or the menu (the basics go to Dina,
      // who saves them with her tool). Changes go to her in the owner's words.
      const part = await answeredPart(r, action.messageId);
      const card = cardFor(part?.card ?? "basics", await chatSources(r));
      const asIs = !Object.keys(action.changes).length;
      const done = asIs ? await handleAnswer({ restaurantId: r, messageId: action.messageId, choiceId: "confirm", channel: "web", externalId: action.clientId }) : null;
      return {
        event: "message",
        text: confirmText(card, action.changes),
        externalId: action.clientId,
        ownerParts: [{ type: "answer", to: action.messageId, choice: "confirm" }],
        note: typeof done === "string" ? done : null,
      };
    }
    case "skip": {
      const { session } = await chatSources(r).then((s) => ({ session: s.focus }));
      const step = session?.current_step;
      if (!step) return null;
      // "Do this chapter later": asked once first (guide).
      const ask = await guideSkipAsk(r, step);
      if (ask) return { event: "message", text: "Do this chapter later", externalId: action.clientId, codeReply: ask.messages };
      await skipStep(r, step, { channel: "web" });
      await afterSkip(r, step);
      return {
        event: "action",
        text: "Skip for now",
        externalId: action.clientId,
        note: `The owner tapped "Skip for now" on ${STEP_DEFS[step].title}. Code has skipped it and kept it as a setup gap, so don't ask about it now.`,
      };
    }
    case "files": {
      const { checkUploadedFiles } = await import("@/lib/onboarding/dina/uploads-store");
      const { describeFiles, refusedText } = await import("@/lib/onboarding/dina/uploads");
      const { dataForFiles, noteForFiles } = await import("@/lib/onboarding/dina/whatsapp-turn");
      const { saved, refused } = await checkUploadedFiles(r, action.paths);
      const step = (await chatSources(r)).focus?.current_step ?? null;
      // The logo or dish photos for code's look questions (guide).
      const looked = saved.length ? await guideFiles({ restaurantId: r, files: saved, channel: "web" }) : null;
      if (looked) return { event: "message", text: `📎 ${describeFiles(saved)}`, externalId: action.clientId, ownerParts: saved, codeReply: looked.messages };
      const refusal = refusedText(refused);
      const note = [saved.length ? await noteForFiles(r, step, saved, "in the chat") : null, refusal ? `Some files couldn't be used; tell them in a line: "${refusal}"` : null]
        .filter(Boolean)
        .join(" ");
      const data = saved.length ? await dataForFiles(r, step, saved) : [];
      return { event: "message", text: saved.length ? `📎 ${describeFiles(saved)}` : "📎 a file I couldn't use", externalId: action.clientId, ownerParts: saved, note, data };
    }
    case "jump": {
      // A chapter from the chapter list: its first step left to do.
      const { CHAPTERS } = await import("@/lib/onboarding/guide/chapters");
      const chapter = CHAPTERS[action.step as keyof typeof CHAPTERS];
      if (chapter) {
        const { state } = await (await import("@/lib/onboarding/sessions")).loadFlow(r);
        const { stepState } = await import("@/lib/onboarding/flow");
        action = { ...action, step: chapter.steps.find((k) => stepState(state, k).status !== "done") ?? chapter.steps[0] };
      }
      if (!isFlowStep(action.step)) throw new FlowError("That step doesn't exist", "unavailable");
      await enterStep(r, action.step, { channel: "web" });
      // A chapter that's all answered (from the summary or Settings): its recap, with a
      // Change on every answer, rather than starting it again (7 Nov 2026).
      const { chapterOf } = await import("@/lib/onboarding/guide/chapters");
      const { openQuestions, isRecap } = await import("@/lib/onboarding/guide/questions");
      const { loadFacts } = await import("@/lib/onboarding/guide/next");
      const { recapText } = await import("@/lib/onboarding/guide/cards");
      const ch = chapterOf(action.step);
      const facts = await loadFacts(r);
      if (ch && ch.recap !== false && ch.steps.every((k) => openQuestions(k, facts).every((q) => isRecap(q.id)))) {
        return { event: "message", text: `Change ${ch.title.toLowerCase()}`, externalId: action.clientId, codeReply: [{ text: recapText(ch.key), component: { type: "recap", chapter: ch.key } }] };
      }
      return {
        event: "action",
        text: `Let's do ${STEP_DEFS[action.step].title.toLowerCase()} now`,
        externalId: action.clientId,
        note: `The owner picked ${STEP_DEFS[action.step].title} from the step list to do now. Code has moved you there.`,
      };
    }
  }
}

// The card the owner is looking at: Dina's last message, if they haven't written since.
async function askingCard(restaurantId: string) {
  const { data } = await getSupabase().from("onboarding_messages").select("id, role, parts").eq("restaurant_id", restaurantId).order("created_at", { ascending: false }).limit(3);
  const last = (data ?? [])[0] as { id: string; role: string; parts: unknown[] | null } | undefined;
  if (!last || last.role !== "dina") return null;
  return { messageId: last.id, part: (last.parts?.[0] ?? {}) as { type?: string; q?: string } };
}
