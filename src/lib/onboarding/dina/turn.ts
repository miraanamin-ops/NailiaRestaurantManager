import "server-only";
import { randomUUID } from "node:crypto";
import { alertBuilder } from "@/lib/builder-alerts";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { currentStep, STEP_DEFS, statusOf, type FlowStepKey } from "../flow";
import { enterStep, getSession, loadFlow, startOnboarding, type Channel } from "../sessions";
import { getRestaurant } from "../store";
import { callDina, DinaReplyError, routeStep, type Call, type ToolCall } from "./call";
import { turnText, type DataBlock, type HistoryLine, type TurnEvent } from "./prompt";
import { fallbackReply, type DinaReply } from "./reply";
import { TOOLS } from "./tools";

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
};

export type TurnResult =
  | { duplicate: true }
  | { duplicate: false; reply: DinaReply; step: FlowStepKey | null; costUsd: number; fallback: boolean; toolCalls: ToolCall[] };

// What Dina may be told about the restaurant: its own details only. Never the
// customer list, and (from the menu step on) only allergens the owner confirmed.
const KNOWN_FIELDS = ["owner_name", "name", "address", "cuisine", "phone", "website", "google_rating", "google_rating_count"] as const;

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export async function dinaTurn(input: TurnInput): Promise<TurnResult> {
  const supabase = getSupabase();
  const id = input.restaurantId;
  const session = (await getSession(id)) ?? (await startOnboarding(id, { channel: input.channel }));

  // 1. The owner's message, once.
  let ownerMessageId: string | null = null;
  if (input.event === "message") {
    ownerMessageId = randomUUID();
    const { error } = await supabase
      .from("onboarding_messages")
      .insert({ id: ownerMessageId, restaurant_id: id, role: "owner", channel: input.channel, step_key: session.current_step, body: input.text ?? "", external_id: input.externalId ?? null });
    if (error?.code === "23505") return { duplicate: true };
    if (error) throw new Error(`Couldn't save the owner's message: ${error.message}`);
  }

  const calls: Call[] = [];
  let { state } = await loadFlow(id);
  let step: FlowStepKey | null = session.current_step ?? currentStep(state);

  // 2. Is it about another step? (Only for real sentences: a tap or a "yes" isn't.)
  if (input.event === "message" && input.text && words(input.text) >= 3) {
    try {
      const routed = await routeStep(input.text, step);
      calls.push(routed.call);
      if (routed.step && STEP_DEFS[routed.step].available) {
        await enterStep(id, routed.step, { channel: input.channel });
        step = routed.step;
      }
    } catch (err) {
      console.warn("The setup router failed; staying on the current step", err instanceof Error ? err.message : err);
    }
  }
  if (step && statusOf(state, step) === "not_started") await enterStep(id, step, { channel: input.channel });
  state = (await loadFlow(id)).state;

  // 3. Dina, with what we know, where we are and the recent chat.
  const restaurant = await getRestaurant(id);
  const known = Object.fromEntries(KNOWN_FIELDS.map((k) => [k, restaurant[k as keyof typeof restaurant] ?? null]));
  const history = await recentChat(id, ownerMessageId);
  const content = turnText({ restaurant: known, state, step, channel: input.channel, event: input.event, history, ownerText: input.text ?? null, data: input.data ?? [] });

  let reply: DinaReply;
  let fallback = false;
  let toolCalls: ToolCall[] = [];
  try {
    const answer = await callDina({ content, step, ctx: { restaurantId: id, channel: input.channel }, tools: TOOLS });
    reply = answer.reply;
    calls.push(...answer.calls);
    toolCalls = answer.toolCalls;
  } catch (err) {
    // 4. Never leave the owner without an answer, or show an unchecked one.
    if (err instanceof DinaReplyError) {
      calls.push(...err.calls);
      toolCalls = err.toolCalls;
    }
    console.error("Dina's turn failed; sending the fallback", err);
    await alertBuilder(`dina-failed:${id}`, `Dina couldn't answer during setup (${step ?? "end"}): ${err instanceof Error ? err.message : String(err)}. The owner got the fallback line.`).catch(() => {});
    reply = fallbackReply((await getSession(id))?.current_step ?? step);
    fallback = true;
  }

  // 5. Her messages, and what this turn cost.
  const after = (await getSession(id)) ?? session;
  const stepNow = after.current_step;
  check(
    await supabase.from("onboarding_messages").insert(
      reply.messages.map((m) => ({ restaurant_id: id, role: "dina", channel: input.channel, step_key: stepNow, body: m.text, parts: m.component ? [m.component] : [] })),
    ),
  );
  const costUsd = await logUsage(id, session.started_at, step, calls);
  return { duplicate: false, reply, step: stepNow, costUsd, fallback, toolCalls };
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
