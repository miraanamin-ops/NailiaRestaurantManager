import "server-only";
import { logAction } from "@/lib/audit";
import type { Turn } from "@/lib/bot/turn";
import { check, getActiveDraft, type Draft } from "@/lib/drafts";
import { sendAndLog } from "@/lib/notify";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { sendDinaChoices } from "@/lib/whatsapp";
import { ALL_DONE, flowId, FLOW_STEPS, NEXT_BUTTONS, nextPrompt, nextStep, NOTHING_TO_DO, parseFlowButton, parseFlowWords, STOPPED, type FlowInput, type FlowState, type FlowStep } from "./flow";
import type { BusinessReview } from "./types";

// The guided flow after the business review (rules in flow.ts). Each step is a
// handler (flow-steps.ts): whether it has anything, how it's shown, what its
// buttons do. A step's own work (approving replies, applying fixes) goes through
// the usual drafts, checks, release gate, audit log and UNDO.

export type FlowButton = { id: string; title: string };
export type FlowCtx = {
  turn: Turn;
  review: BusinessReview;
  restaurant: Restaurant;
  // A message with up to 3 buttons (or none), logged like any other; mediaUrl: a file first (the poster).
  say: (text: string, buttons?: FlowButton[], mediaUrl?: string | null) => Promise<void>;
  button: (step: FlowStep, choice: string, title: string) => FlowButton;
};
// "done": the step is finished (Next? follows). "stay": the step is still going
// (e.g. the next reply in one-by-one is showing).
export type StepOutcome = "done" | "stay";
export type StepHandler = {
  available(ctx: FlowCtx): Promise<boolean>;
  show(ctx: FlowCtx): Promise<StepOutcome>;
  choose(ctx: FlowCtx, choice: string): Promise<StepOutcome>;
  // After Approve / Edit / Skip on one of this step's drafts (one by one).
  afterDecision?(ctx: FlowCtx, draft: Draft): Promise<StepOutcome>;
};

let steps: Partial<Record<FlowStep, StepHandler>> | null = null;
async function handlers() {
  steps ??= (await import("./flow-steps")).FLOW_HANDLERS;
  return steps;
}
// Tests swap the handlers in.
export function setFlowHandlersForTests(h: Partial<Record<FlowStep, StepHandler>> | null) {
  steps = h;
}

const db = () => getSupabase();

async function reviewFor(restaurantId: string) {
  try {
    return check(await db().from("business_reviews").select("*").eq("restaurant_id", restaurantId).maybeSingle<BusinessReview>());
  } catch {
    return null; // before supabase/058
  }
}

async function save(review: BusinessReview, fields: Partial<BusinessReview>) {
  Object.assign(review, fields);
  check(await db().from("business_reviews").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", review.id));
}

function ctxFor(turn: Turn, review: BusinessReview): FlowCtx {
  const say = async (text: string, buttons: FlowButton[] = [], mediaUrl: string | null = null) => {
    if (mediaUrl) await turn.send("", false, mediaUrl);
    if (!buttons.length) return turn.send(text);
    // Remember the buttons on screen, so a typed 1, 2 or 3 means the same.
    review.flow_state = { ...review.flow_state, buttons: buttons.map((b) => b.id) };
    await save(review, { flow_state: review.flow_state });
    await sendAndLog(turn.channel, () => sendDinaChoices(turn.channel.from, turn.channel.to, { kind: "buttons", body: text, options: buttons.slice(0, 3).map((b) => ({ id: b.id, title: b.title, description: "" })) }), text);
  };
  return { turn, review, restaurant: turn.ctx.restaurant, say, button: (step, choice, title) => ({ id: flowId(review.id, `${step}:${choice}`), title }) };
}

const stateOf = (review: BusinessReview) => (review.flow_state ?? {}) as FlowState & { buttons?: string[] };

async function availableSteps(ctx: FlowCtx) {
  const h = await handlers();
  const out: FlowStep[] = [];
  for (const s of FLOW_STEPS) if (h[s] && (await h[s]!.available(ctx).catch(() => false))) out.push(s);
  return out;
}

// Shows the next step with something in it; when there's none left, the end.
async function showNext(ctx: FlowCtx) {
  const h = await handlers();
  for (;;) {
    const done = stateOf(ctx.review).done ?? [];
    const step = nextStep(done, await availableSteps(ctx));
    if (!step) {
      await save(ctx.review, { flow_step: null, flow_ended_at: new Date().toISOString() });
      await ctx.say(done.length ? ALL_DONE : NOTHING_TO_DO);
      await logAction({ restaurantId: ctx.restaurant.id, actor: "owner", action: "business_review", detail: "Went through the business review to the end" });
      return;
    }
    await save(ctx.review, { flow_step: step });
    const outcome = await h[step]!.show(ctx);
    if (outcome === "stay") return;
    // Shown and finished at once (e.g. the poster): straight on to "Next?".
    if (await stepDone(ctx, step)) return;
  }
}

// A step finished: mark it, then "Next?" (true) or, with nothing after it, the end (false).
async function stepDone(ctx: FlowCtx, step: FlowStep) {
  const state = stateOf(ctx.review);
  const done = [...new Set([...(state.done ?? []), step])];
  await save(ctx.review, { flow_step: null, flow_state: { ...state, done, buttons: [] } });
  const upNext = nextStep(done, await availableSteps(ctx));
  const prompt = nextPrompt(upNext);
  if (!prompt) return false;
  await ctx.say(prompt, NEXT_BUTTONS(ctx.review.id, upNext));
  return true;
}

async function act(ctx: FlowCtx, input: FlowInput) {
  const h = await handlers();
  const current = ctx.review.flow_step as FlowStep | null;
  if (input.kind === "stop") {
    await save(ctx.review, { flow_step: null, flow_ended_at: new Date().toISOString() });
    await logAction({ restaurantId: ctx.restaurant.id, actor: "owner", action: "business_review", detail: "Stopped the business review for now (the rest waits in the brief)" });
    return ctx.say(STOPPED);
  }
  if (input.kind === "go") {
    if (!ctx.review.flow_started_at || ctx.review.flow_ended_at) {
      await save(ctx.review, { flow_started_at: ctx.review.flow_started_at ?? new Date().toISOString(), flow_ended_at: null });
      await logAction({ restaurantId: ctx.restaurant.id, actor: "owner", action: "business_review", detail: "Started going through the business review" });
    }
    // Carrying on: the step on screen again, or the next one.
    if (current && h[current]) {
      if ((await h[current]!.show(ctx)) === "done" && !(await stepDone(ctx, current))) await showNext(ctx);
      return;
    }
    return showNext(ctx);
  }
  if (input.kind === "next") {
    // Next while a step is showing passes over it (its drafts wait in the brief).
    if (current) {
      const state = stateOf(ctx.review);
      await save(ctx.review, { flow_step: null, flow_state: { ...state, done: [...new Set([...(state.done ?? []), current])], buttons: [] } });
    }
    return showNext(ctx);
  }
  let choice: { step: FlowStep; choice: string } | null = input.kind === "choose" ? { step: input.step, choice: input.choice } : null;
  if (input.kind === "number") {
    const id = stateOf(ctx.review).buttons?.[input.n - 1];
    const parsed = id ? parseFlowButton(id) : null;
    if (!parsed) return false;
    if (parsed.input.kind !== "choose") return act(ctx, parsed.input);
    choice = { step: parsed.input.step, choice: parsed.input.choice };
  }
  if (!choice || !h[choice.step]) return ctx.say("That isn't waiting for an answer any more. Reply GO to carry on with your review.");
  if (choice.step !== current) await save(ctx.review, { flow_step: choice.step });
  const outcome = await h[choice.step]!.choose(ctx, choice.choice);
  if (outcome === "done" && !(await stepDone(ctx, choice.step))) await showNext(ctx);
}

// One owner message: true if it was for the review's guided flow (and was handled).
export async function handleReviewFlow(turn: Turn, body: string, buttonPayload: string | undefined): Promise<boolean> {
  const tapped = parseFlowButton(buttonPayload);
  if (!tapped && buttonPayload) return false;
  const review = await reviewFor(turn.ctx.restaurantId);
  if (!review || review.status !== "sent") {
    if (tapped) await turn.send("That review isn't ready yet. I'll message you as soon as it is.");
    return Boolean(tapped);
  }
  if (tapped && tapped.reviewId !== review.id) {
    await turn.send("That's from an older review. Reply GO to go through the latest one.");
    return true;
  }
  let input = tapped?.input ?? null;
  if (!input) {
    const flowOn = Boolean(review.flow_started_at && !review.flow_ended_at);
    const active = await getActiveDraft(turn.ctx.restaurantId).catch(() => null);
    input = parseFlowWords(body, { flowOn, draftOnScreen: active?.waiting_for === "decision" || active?.waiting_for === "edit_instructions" });
  }
  if (!input) return false;
  const handled = await act(ctxFor(turn, review), input);
  return handled !== false;
}

// After Approve / Edit / Skip on a draft the review made, while its step is on
// screen: the step goes on (the next reply) or finishes (Next?).
export async function afterReviewDecision(turn: Turn, draft: Pick<Draft, "id"> & { business_review_id?: string | null }) {
  if (!draft.business_review_id) return;
  const review = await reviewFor(turn.ctx.restaurantId);
  if (!review || review.id !== draft.business_review_id || !review.flow_step || review.flow_ended_at) return;
  const h = await handlers();
  const step = review.flow_step as FlowStep;
  const handler = h[step];
  if (!handler?.afterDecision) return;
  const full = check(await db().from("drafts").select("*").eq("id", draft.id).eq("restaurant_id", review.restaurant_id).maybeSingle<Draft>());
  if (!full) return;
  const ctx = ctxFor(turn, review);
  if ((await handler.afterDecision(ctx, full)) === "done" && !(await stepDone(ctx, step))) await showNext(ctx);
}
