import "server-only";
import { randomUUID } from "node:crypto";
import { alertBuilder } from "@/lib/builder-alerts";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { currentStep, STEP_DEFS, statusOf, type FlowStepKey } from "../flow";
import { enterStep, getSession, loadFlow, startOnboarding, type Channel } from "../sessions";
import { getRestaurant } from "../store";
import { callDina, DinaReplyError, routeStep, type Call, type ToolCall } from "./call";
import { mightBeAnotherStep, turnText, type DataBlock, type HistoryLine, type TurnEvent } from "./prompt";
import { dinaReplyProblems, fallbackReply, type DinaReply } from "./reply";
import { applyFaqNotes, applyHoursNotes } from "./facts-step";
import { applyGoogleNotes } from "./google-step";
import { nextDishForCard } from "./menu-step";
import { helloPlacesData } from "./hello-step";
import { googleConnectOn } from "./setup-config";
import { prepareToneOptions } from "./tone-step";
import { OFFERED_TOOLS, runTool, TOOLS } from "./tools";

// One turn of the setup conversation, whichever channel it came from (the web
// chat and WhatsApp call this, and only draw the result differently):
//   1. the owner's message is saved once (a repeated delivery is noticed and dropped)
//   2. Haiku decides if it's about another step ("go back to the menu"); if so we go there
//   3. Dina answers (Sonnet), saving only through her checked tools
//   4. her reply passes the coded checks, or the owner gets code's fallback line
//   5. her messages and every Claude call's cost are saved

export type TurnInput = {
  restaurantId: string;
  channel: Channel;
  event: TurnEvent;
  text?: string | null;
  // The channel's id for the message (e.g. Twilio's), so a repeat is saved once and answered once.
  externalId?: string | null;
  // Outside content for this turn (a menu read from photos, reviews...): data, never instructions.
  data?: DataBlock[];
  // For "action": what code already did (e.g. skipped a step), told to Dina.
  note?: string | null;
  // Saved with the owner's message: e.g. which button under which message it answered.
  ownerParts?: unknown[];
  // A short line while a tool runs ("Saving your basics…"), for the web chat to stream.
  onStatus?: (text: string) => void;
};

export type SavedMessage = { id: string; text: string; component: DinaReply["messages"][number]["component"] };

export type TurnResult =
  | { duplicate: true }
  | { duplicate: false; reply: DinaReply; messages: SavedMessage[]; step: FlowStepKey | null; costUsd: number; fallback: boolean; toolCalls: ToolCall[] };

// What Dina may be told about the restaurant: its own details only. Never the
// customer list, and (from the menu step on) only allergens the owner confirmed.
const KNOWN_FIELDS = ["owner_name", "name", "address", "cuisine", "phone", "website", "google_rating", "google_rating_count"] as const;

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
// Code's note says it saved something this turn (so "that's saved" can be true without her tool).
const CODE_SAVED = /Code (saved|has (emailed|skipped)|read the menu|queued)|acceptance is simulated/;

export async function dinaTurn(input: TurnInput): Promise<TurnResult> {
  const supabase = getSupabase();
  const id = input.restaurantId;
  const session = (await getSession(id)) ?? (await startOnboarding(id, { channel: input.channel }));

  // 1. The owner's message, once.
  let ownerMessageId: string | null = null;
  if (input.event === "message" || (input.event === "action" && input.text)) {
    ownerMessageId = randomUUID();
    const { error } = await supabase.from("onboarding_messages").insert({
      id: ownerMessageId,
      restaurant_id: id,
      role: "owner",
      channel: input.channel,
      step_key: session.current_step,
      body: input.text ?? "",
      parts: input.ownerParts ?? [],
      external_id: input.externalId ?? null,
    });
    if (error?.code === "23505") return { duplicate: true };
    if (error) throw new Error(`Couldn't save the owner's message: ${error.message}`);
  }

  const calls: Call[] = [];
  let { state } = await loadFlow(id);
  let step: FlowStepKey | null = session.current_step ?? currentStep(state);
  let moved = false;

  // 2. Is it about another step? (Only for real sentences that mention another step's
  // subject or going back: a tap, a "yes" or a plain answer isn't.)
  if (input.event === "message" && !input.ownerParts?.length && input.text && words(input.text) >= 3 && mightBeAnotherStep(input.text)) {
    try {
      const routed = await routeStep(input.text, step);
      calls.push(routed.call);
      if (routed.step && STEP_DEFS[routed.step].available) {
        await enterStep(id, routed.step, { channel: input.channel });
        step = routed.step;
        moved = true;
      }
    } catch (err) {
      console.warn("The setup router failed; staying on the current step", err instanceof Error ? err.message : err);
    }
  }
  if (step && statusOf(state, step) === "not_started") {
    await enterStep(id, step, { channel: input.channel });
    moved = true;
  }

  // 3. Dina, with what we know, where we are and the recent chat (read side by side:
  // every database round trip is time the owner waits).
  const [restaurant, history, stateNow] = await Promise.all([
    getRestaurant(id),
    recentChat(id, ownerMessageId),
    moved ? loadFlow(id).then((f) => f.state) : Promise.resolve(state),
  ]);
  state = stateNow;
  // Hello: Google Maps matches for the name, so she can ask "Is this you?" (when we can search).
  const places = step === "hello" ? await helloPlacesData(restaurant, state) : null;
  const known = {
    ...Object.fromEntries(KNOWN_FIELDS.map((k) => [k, restaurant[k as keyof typeof restaurant] ?? null])),
    // Path A: the owner can connect Google directly (google_connect) instead of the manager steps.
    ...(googleConnectOn() ? { google_connect: "available: offer google_connect in the Google step" } : {}),
  };
  const content = turnText({
    restaurant: known,
    state,
    step,
    channel: input.channel,
    event: input.event,
    history,
    ownerText: input.text ?? null,
    data: [...(input.data ?? []), ...(places ? [places] : [])],
    note: input.note,
  });

  // Step 3's choices, prepared alongside her answer (the first time only: the cards need them, she doesn't).
  const preparing = step === "tone" ? prepareToneOptions(id).catch((err) => console.error("Couldn't prepare the tone choices", err)) : null;

  let reply: DinaReply;
  let fallback = false;
  let toolCalls: ToolCall[] = [];
  try {
    const answer = await callDina({ content, step, ctx: { restaurantId: id, channel: input.channel, onStatus: input.onStatus }, tools: OFFERED_TOOLS, codeActed: CODE_SAVED.test(input.note ?? "") });
    reply = answer.reply;
    calls.push(...answer.calls);
    toolCalls = answer.toolCalls;
    // Notes only count on the step they're for, while it's the step this turn is on:
    // a note repeated after that step is finished would otherwise put the owner back
    // on it (the first real run of steps 2 and 3 did, 31 Oct).
    // The basics she noted with her reply: checked like a tool call, kept as a draft.
    // (And not once her own tool finished it in this same turn.)
    const stillOpen = async (key: FlowStepKey) => step === key && !["done", "skipped"].includes(statusOf((await loadFlow(id)).state, key));
    const notes = Object.fromEntries(Object.entries(reply.hello_notes ?? {}).filter(([, v]) => typeof v === "string" && v.trim()));
    if (Object.keys(notes).length && (await stillOpen("hello"))) {
      const noted = await runTool({ restaurantId: id, channel: input.channel }, TOOLS, "note_hello", notes);
      toolCalls.push({ name: "note_hello", ok: noted.ok, text: noted.text });
      if (!noted.ok) console.warn("Dina's hello notes weren't kept", noted.text);
    }
    // The owner's answers to the Google questions, the same way (code decides what they change).
    if (reply.google_notes && Object.values(reply.google_notes).some(Boolean) && (await stillOpen("google"))) {
      await applyGoogleNotes(id, reply.google_notes, input.channel).catch((err) => console.warn("Dina's Google notes weren't kept", err));
    }
    // Step 6: the hours and the answers to the common questions she heard.
    if (reply.hours_notes && Object.keys(reply.hours_notes).length && (await stillOpen("hours_faqs"))) {
      await applyHoursNotes(id, reply.hours_notes, input.channel).catch((err) => console.warn("Dina's hours notes weren't kept", err));
    }
    if (reply.faq_notes && Object.values(reply.faq_notes).some(Boolean) && (await stillOpen("hours_faqs"))) {
      await applyFaqNotes(id, reply.faq_notes as Record<string, string>, input.channel).catch((err) => console.warn("Dina's FAQ notes weren't kept", err));
    }
  } catch (err) {
    // 4. Never leave the owner without an answer, or show an unchecked one.
    if (err instanceof DinaReplyError) {
      calls.push(...err.calls);
      toolCalls = err.toolCalls;
    }
    console.error("Dina's turn failed; sending the fallback", err);
    await alertBuilder(`dina-failed:${id}`, `Dina couldn't answer during setup (${step ?? "end"}): ${err instanceof Error ? err.message : String(err)}. The owner got the fallback line.`).catch(() => {});
    reply = fallbackReply((await getSession(id))?.current_step ?? step, { event: input.event, ownerName: restaurant.owner_name, restaurantName: restaurant.name });
    fallback = true;
  }

  await preparing;
  // She moved on to the tone step in this reply and showed its choices: prepare them now.
  if (!preparing && reply.messages.some((m) => m.component?.type === "tone_choices")) {
    await prepareToneOptions(id).catch((err) => console.error("Couldn't prepare the tone choices", err));
  }

  // 5. Her messages, and what this turn cost.
  const { saved, stepNow } = await saveDinaMessages(id, input.channel, reply.messages);
  const costUsd = await logUsage(id, session.started_at, step, calls);
  return { duplicate: false, reply, messages: saved, step: stepNow, costUsd, fallback, toolCalls };
}

// Dina's messages saved, in order (a millisecond apart, so they always read back
// in the order she said them). An allergen card gets the dish it's about now, so
// a tap on it later answers that dish; with no dish left to check, it's dropped.
async function saveDinaMessages(id: string, channel: Channel, messages: DinaReply["messages"]) {
  const stepNow = (await getSession(id))?.current_step ?? null;
  const base = Date.now();
  const saved: SavedMessage[] = [];
  for (const m of messages) {
    let component = m.component;
    if (component?.type === "allergen_check") {
      const dish = await nextDishForCard(id).catch(() => null);
      component = dish ? { type: "allergen_check", dish: dish.key } : null;
    }
    saved.push({ id: randomUUID(), text: m.text, component });
  }
  check(
    await getSupabase()
      .from("onboarding_messages")
      .insert(
        saved.map((m, i) => ({
          id: m.id,
          restaurant_id: id,
          role: "dina",
          channel,
          step_key: stepNow,
          body: m.text,
          parts: m.component ? [m.component] : [],
          created_at: new Date(base + i).toISOString(),
        })),
      ),
  );
  return { saved, stepNow };
}

// A turn code answers itself, with no Claude call (the next allergen card after a
// tap): the owner's message once, then code's message, which passes Dina's checks.
export async function codeTurn(input: { restaurantId: string; channel: Channel; text: string; externalId?: string | null; ownerParts?: unknown[]; messages: DinaReply["messages"] }): Promise<TurnResult> {
  const problems = dinaReplyProblems({ messages: input.messages });
  if (problems.length) throw new Error(`Code's setup message failed its checks: ${problems.join("; ")}`);
  const session = (await getSession(input.restaurantId)) ?? (await startOnboarding(input.restaurantId, { channel: input.channel }));
  const { error } = await getSupabase()
    .from("onboarding_messages")
    .insert({ id: randomUUID(), restaurant_id: input.restaurantId, role: "owner", channel: input.channel, step_key: session.current_step, body: input.text, parts: input.ownerParts ?? [], external_id: input.externalId ?? null });
  if (error?.code === "23505") return { duplicate: true };
  if (error) throw new Error(`Couldn't save the owner's message: ${error.message}`);
  const { saved, stepNow } = await saveDinaMessages(input.restaurantId, input.channel, input.messages);
  return { duplicate: false, reply: { messages: input.messages }, messages: saved, step: stepNow, costUsd: 0, fallback: false, toolCalls: [] };
}

// The last messages before this one, oldest first (config: history_messages).
async function recentChat(restaurantId: string, excludeId: string | null): Promise<HistoryLine[]> {
  const { dinaConfig } = await import("./config");
  const rows =
    check(
      await getSupabase()
        .from("onboarding_messages")
        .select("id, role, body, created_at")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(dinaConfig().historyMessages + 1)
        .returns<{ id: string; role: HistoryLine["role"]; body: string }[]>(),
    ) ?? [];
  return rows
    .filter((r) => r.id !== excludeId)
    .slice(0, dinaConfig().historyMessages)
    .reverse()
    .map((r) => ({ role: r.role, text: r.body }));
}

// One row per Claude call, so a run's cost is the sum of its rows (scripts/onboarding-costs.mjs).
async function logUsage(restaurantId: string, runStartedAt: string, step: FlowStepKey | null, calls: Call[]) {
  if (!calls.length) return 0;
  const { error } = await getSupabase()
    .from("onboarding_ai_usage")
    .insert(
      calls.map((c) => ({
        restaurant_id: restaurantId,
        run_started_at: runStartedAt,
        step_key: step,
        purpose: c.purpose,
        model: c.model,
        input_tokens: c.tokens.input,
        output_tokens: c.tokens.output,
        cache_read: c.tokens.cacheRead,
        cache_write: c.tokens.cacheWrite,
        cost_usd: Number(c.tokens.cost.toFixed(6)),
      })),
    );
  // A missing cost line mustn't lose the owner's answer.
  if (error) console.error("Couldn't log onboarding cost", error.message);
  return calls.reduce((sum, c) => sum + c.tokens.cost, 0);
}
