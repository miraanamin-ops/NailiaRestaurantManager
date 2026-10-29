import { z } from "zod";
import { currentOwner } from "@/lib/auth";
import { FlowError, isFlowStep, STEP_DEFS } from "@/lib/onboarding/flow";
import { chatSources } from "@/lib/onboarding/dina/chat";
import { dinaTurn, type TurnInput } from "@/lib/onboarding/dina/turn";
import { cardFor, chatMessage, confirmText, progressFrom, skippableNow } from "@/lib/onboarding/dina/view";
import { enterStep, skipStep } from "@/lib/onboarding/sessions";
import { limitKey, MINUTE, overLimit } from "@/lib/rate-limit";

// The web chat with Dina: one owner action in, Dina's answer streamed back as
// lines of JSON (one event per line):
//   {"type":"typing"}                 straight away
//   {"type":"status","text":"…"}      while one of her tools runs ("Saving your basics…")
//   {"type":"message","message":{…}}  each of her messages, already checked, one after another
//   {"type":"state","progress":{…},"skippable":true}
//   {"type":"done"}  or  {"type":"error","text":"…"}
// Dina's words are checked before they're shown (lib/onboarding/dina/reply.ts), so
// they arrive whole, message by message, never word by word.
// Only the restaurant's own owner (or the builder) can use it; a repeated send (same
// clientId) is answered once; at most 40 turns per restaurant per 10 minutes.

export const maxDuration = 120;

const Action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("message"), text: z.string().trim().min(1).max(2000), clientId: z.string().uuid() }),
  z.object({ kind: z.literal("answer"), messageId: z.string().uuid(), choiceId: z.string().min(1).max(40), label: z.string().min(1).max(60), clientId: z.string().uuid() }),
  z.object({ kind: z.literal("confirm"), messageId: z.string().uuid(), changes: z.record(z.string().max(40), z.string().max(300)), clientId: z.string().uuid() }),
  z.object({ kind: z.literal("skip"), clientId: z.string().uuid() }),
  z.object({ kind: z.literal("jump"), step: z.string(), clientId: z.string().uuid() }),
]);
const Body = z.object({ r: z.string().uuid(), action: Action });

const MESSAGE_GAP_MS = 450;
const TURNS = { max: 40, windowMs: 10 * MINUTE };

export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return Response.json({ error: "Please log in again." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That didn't look right." }, { status: 400 });
  const { r, action } = parsed.data;
  if (!owner.restaurantIds.includes(r)) return Response.json({ error: "Not your restaurant." }, { status: 403 });
  if (action.kind !== "start" && (await overLimit([{ key: limitKey("dina-turn", r), ...TURNS }]))) {
    return Response.json({ error: "That's a lot of messages in a short time. Give it a few minutes." }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send({ type: "typing" });
        const input = await turnFor(r, action);
        if (!input) {
          send({ type: "done" });
          return;
        }
        const result = await dinaTurn({ ...input, restaurantId: r, channel: "web", onStatus: (text) => send({ type: "status", text }) });
        if (result.duplicate) {
          send({ type: "done" });
          return;
        }
        const sources = await chatSources(r);
        for (const [i, m] of result.messages.entries()) {
          if (i) await new Promise((res) => setTimeout(res, MESSAGE_GAP_MS));
          send({ type: "message", message: chatMessage({ id: m.id, role: "dina", body: m.text, parts: m.component ? [m.component] : [] }, sources) });
        }
        const focus = sources.focus?.current_step ?? null;
        send({ type: "state", progress: progressFrom(sources.state, focus), skippable: skippableNow(focus) });
        send({ type: "done" });
      } catch (err) {
        console.error("The web chat turn failed", err);
        send({ type: "error", text: err instanceof FlowError ? `${err.message}.` : "Sorry, something went wrong on my side. Please try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

// What each tap or message means for Dina's turn. Skipping and jumping are done by
// code first (Dina is told what happened); everything else is the owner's answer.
async function turnFor(r: string, action: z.infer<typeof Action>): Promise<Omit<TurnInput, "restaurantId" | "channel"> | null> {
  switch (action.kind) {
    case "start": {
      // Only the very first time: a reload never makes her say hello twice.
      const { getSupabase } = await import("@/lib/supabase");
      const { count } = await getSupabase().from("onboarding_messages").select("id", { count: "exact", head: true }).eq("restaurant_id", r);
      return count ? null : { event: "start" };
    }
    case "message":
      return { event: "message", text: action.text, externalId: action.clientId };
    case "answer":
      return { event: "message", text: action.label, externalId: action.clientId, ownerParts: [{ type: "answer", to: action.messageId, choice: action.choiceId }] };
    case "confirm": {
      const sources = await chatSources(r);
      const card = cardFor("basics", sources);
      return { event: "message", text: confirmText(card, action.changes), externalId: action.clientId, ownerParts: [{ type: "answer", to: action.messageId, choice: "confirm" }] };
    }
    case "skip": {
      const { session } = await chatSources(r).then((s) => ({ session: s.focus }));
      const step = session?.current_step;
      if (!step) return null;
      await skipStep(r, step, { channel: "web" });
      return {
        event: "action",
        text: "Skip for now",
        externalId: action.clientId,
        note: `The owner tapped "Skip for now" on ${STEP_DEFS[step].title}. Code has skipped it and kept it as a setup gap, so don't ask about it now.`,
      };
    }
    case "jump": {
      if (!isFlowStep(action.step)) throw new FlowError("That step doesn't exist", "unavailable");
      await enterStep(r, action.step, { channel: "web" });
      return {
        event: "action",
        text: `Let's do ${STEP_DEFS[action.step].title.toLowerCase()} now`,
        externalId: action.clientId,
        note: `The owner picked ${STEP_DEFS[action.step].title} from the step list to do now. Code has moved you there.`,
      };
    }
  }
}
