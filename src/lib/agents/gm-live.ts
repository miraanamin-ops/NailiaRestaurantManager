import "server-only";
import { extractProfileChanges } from "@/lib/assistant";
import { logAction } from "@/lib/audit";
import { check, createDraft, saveSkipReason, updateDraft, type Draft } from "@/lib/drafts";
import { draftMessage } from "@/lib/format";
import type { Send } from "@/lib/google-jobs";
import { planProfileChanges, type ProfileChange } from "@/lib/onboarding/profile-changes";
import { applyProfileChanges } from "@/lib/profile-edits";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import type { Turn } from "@/lib/bot/turn";
import { composeChecked, gmProfile, routeMessage } from "./gm";
import { buttonLabel, expectedLanguage, ON_IT_AFTER_MS, ON_IT_LINES, ROUTE_WORDS, SKIP_REASONS, type LanguageSeen, type Route } from "./gm-rules";
import { recordAgentRun } from "./jobs";

// The GM live (test mode only, once its checklist passes): it routes each owner
// message to the specialist (by that specialist's own mode: live = it answers;
// shadow = today's code answers, as before), answers simple profile questions
// itself, turns a fact about the restaurant into a confirm card, asks one question
// with buttons when a message is unclear, and sends one "on it" line when a reply
// won't be ready in about 8 seconds. Anything it doesn't handle goes to today's
// assistant (the caller falls back when this returns false).

// The "on it" line: once, only if the work isn't done within ON_IT_AFTER_MS.
export async function withOnIt<T>(work: Promise<T>, send: Send, language: LanguageSeen): Promise<T> {
  let done = false;
  const timer = new Promise<void>((resolve) =>
    setTimeout(async () => {
      if (!done) await send(ON_IT_LINES[language]).catch(() => {});
      resolve();
    }, ON_IT_AFTER_MS),
  );
  try {
    return await work;
  } finally {
    done = true;
    void timer;
  }
}

async function logRoute(r: Restaurant, message: string, route: Route, ms: number, usage: Parameters<typeof recordAgentRun>[0]["usage"]) {
  const key = `gm:live:${r.id}:${Date.now()}`;
  const jobId = await recordAgentRun({ restaurantId: r.id, key, agent: "gm", kind: "gm_live", trigger: "owner_message", output: { route, router_ms: ms }, agentVersion: "gm", verdict: route, usage });
  await logAction({ restaurantId: r.id, actor: "gm", action: "agent_drafted", detail: `GM routed "${message.slice(0, 60)}" to ${ROUTE_WORDS[route]}`, data: { job_key: key, kind: "gm_live" }, job: { jobId, agent: "gm", agentVersion: "gm", verdict: route } });
}

// Routes the message and handles it if a live part of the system can. Returns false
// for today's assistant to answer (general chat, look-ups, a specialist in shadow).
export async function gmLive(turn: Turn, body: string, active: Draft | null, forcedRoute?: Route): Promise<boolean> {
  const { ctx, owner, send } = turn;
  const r = ctx.restaurant;
  const language = expectedLanguage({ ownerMessage: body });
  let route = forcedRoute ?? null;
  let request = body;
  if (!route) {
    const routed = await routeMessage(r.id, owner, body, active);
    if (!routed) return false;
    await logRoute(r, body, routed.output.route, routed.ms, routed.usage);
    route = routed.output.route;
    request = routed.output.request || body;
    if (route === "ambiguous") {
      await choiceCard(r, body, routed.output.question ?? "What would you like me to do?", routed.output.options, send);
      return true;
    }
  }
  return dispatch(turn, body, request, route, language);
}

async function dispatch(turn: Turn, body: string, request: string, route: Route, language: LanguageSeen): Promise<boolean> {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  switch (route) {
    case "profile_question": {
      const profile = await gmProfile(r.id);
      const reply = await composeChecked(r.id, { kind: "reply", owner: { owner_name: r.owner_name, language: r.owner_language, restaurant: r.name }, owner_message: body, profile: profile.fields }, "an owner question (live)");
      // A reply the checker didn't pass isn't sent: today's assistant answers instead.
      if (reply.verdict && reply.verdict !== "pass") return false;
      await send(reply.message);
      return true;
    }
    case "profile_fact":
      return factCard(turn, body);
    case "insights": {
      const { insightsMode, answerWithInsights } = await import("./insights");
      if ((await insightsMode(r)) !== "live") return false;
      return withOnIt(answerWithInsights(r, body, ctx.now, send), send, language);
    }
    case "growth": {
      const { growthMode, liveGrowthRequest } = await import("./growth");
      if ((await growthMode(r)) !== "live") return false;
      return withOnIt(liveGrowthRequest(r, body, ctx.now, send), send, language);
    }
    case "visibility": {
      const { visibilityMode, queueVisibilityLive } = await import("./visibility");
      if ((await visibilityMode(r)) !== "live") return false;
      // Runs straight after this reply (the webhook runs queued agent work); the draft arrives then.
      await queueVisibilityLive(r, { task: "google_post", slot: "owner_request", request }, `visibility:request:${Date.now()}`);
      await send(ON_IT_LINES[language]);
      return true;
    }
    case "one_off": {
      const { visibilityMode, runVisibilityFor } = await import("./visibility");
      if ((await visibilityMode(r)) !== "live") return false;
      const result = await withOnIt(runVisibilityFor(r, { task: "one_off", request }, "one-off writing (live)"), send, language);
      const o = result.outcome;
      if (o.kind === "question") await send(`❓ ${o.question}`);
      else if (o.kind === "reply") await send(`✍️ Here it is, ready for you to send or print:\n\n${o.output.content.text}`);
      else return false;
      return true;
    }
    // Reviews and complaints, general chat and look-ups: today's assistant
    // (which uses Reputation live for pasted reviews).
    default:
      return false;
  }
}

// ---------- "Which did you mean?" ----------

async function choiceCard(r: Restaurant, message: string, question: string, options: { label: string; route: Route }[], send: Send) {
  const opts = options.slice(0, 3).map((o) => ({ label: buttonLabel(o.label), route: o.route }));
  const draft = await createDraft({ restaurantId: r.id, kind: "choice", content: question, audience: "you", request: message, checks: {}, mode: "present", actor: "gm", agentInput: { message, options: opts } });
  await send(question, { draftId: draft.id, buttons: "choice", options: opts.map((o) => o.label) });
}

// The owner picked option n (a button, or a typed 1 to 3): carry on with the original message.
export async function answerChoice(turn: Turn, draft: Draft, n: number) {
  const input = (draft as Draft & { agent_input?: { message: string; options: { label: string; route: Route }[] } }).agent_input;
  const option = input?.options[n - 1];
  if (!input || !option) {
    await turn.send(`Reply 1 to ${input?.options.length ?? 3}, or just tell me what you need.`);
    return { handled: true as const };
  }
  await updateDraft(draft.id, { status: "answered", waiting_for: null });
  const handled = await dispatch(turn, input.message, input.message, option.route, expectedLanguage({ ownerMessage: input.message }));
  // Not handled live (chat, a specialist in shadow): today's assistant answers the original message.
  return handled ? { handled: true as const } : { handled: false as const, message: input.message };
}

// ---------- A fact about the restaurant: a confirm card ----------

async function factCard(turn: Turn, body: string) {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  const changes = await extractProfileChanges(ctx, body);
  if (!changes.length) return false; // not one Naila can change by message: today's assistant explains
  const plan = planProfileChanges(r, changes);
  if (!plan.lines.length) {
    await send(plan.problems.join("\n") || (plan.unchanged ? "That's already how it is, so there's nothing to change." : "Sorry, I didn't catch what to change."));
    return true;
  }
  const content = `Change your details?\n${plan.lines.map((l) => `- ${l}`).join("\n")}${plan.problems.length ? `\n\n${plan.problems.join("\n")}` : ""}`;
  const draft = await createDraft({ restaurantId: r.id, kind: "profile_change", content, audience: "your details", request: body, checks: {}, mode: "present", actor: "gm", agentInput: { changes } });
  await send(draftMessage(draft, r), true);
  return true;
}

// Approve on a fact card: the change is saved (UNDO puts it back).
export async function approveFact(turn: Turn, draft: Draft) {
  const changes = ((draft as Draft & { agent_input?: { changes: ProfileChange[] } }).agent_input?.changes ?? []) as ProfileChange[];
  await updateDraft(draft.id, { status: "approved", approved_at: new Date().toISOString(), waiting_for: null });
  const restaurant = check(await getSupabase().from("restaurants").select("*").eq("id", turn.ctx.restaurantId).single<Restaurant>())!;
  await turn.send(await applyProfileChanges(restaurant, changes));
}

// Edit on a fact card: the owner's correction is read again, as a new card.
export async function correctFact(turn: Turn, draft: Draft, correction: string) {
  await updateDraft(draft.id, { status: "superseded", waiting_for: null });
  const handled = await factCard(turn, `${draft.request ?? ""}\nCorrection: ${correction}`);
  if (!handled) await turn.send("Sorry, I couldn't read that change. Try e.g. _change Friday hours to 11pm_, or use the settings page.");
}

// ---------- Questions from scheduled work, special ideas, skip reasons ----------

// The owner answered a question an agent asked (typed, while it's on screen).
export async function answerAgentQuestion(turn: Turn, draft: Draft, answer: string) {
  const input = (draft as Draft & { agent_input?: { agent?: string; job?: { request?: string | null } } }).agent_input ?? {};
  await updateDraft(draft.id, { status: "answered", waiting_for: null });
  await logAction({ restaurantId: draft.restaurant_id, draftId: draft.id, actor: "owner", action: "answered", detail: `Answered: "${answer.slice(0, 80)}"`, data: { question: draft.content, answer } });
  if (input.agent === "growth") {
    const { growthMode, liveGrowthRequest } = await import("./growth");
    if ((await growthMode(turn.ctx.restaurant)) === "live") {
      const request = `${input.job?.request ? `${input.job.request}\n` : ""}You asked: ${draft.content}\nThe owner answered: ${answer}`;
      await withOnIt(liveGrowthRequest(turn.ctx.restaurant, request, turn.ctx.now, turn.send), turn.send, expectedLanguage({ ownerMessage: answer }));
      return;
    }
  }
  await turn.send("👍 Thanks, noted.");
}

// Like it / Skip on a special idea (Draft only: nothing is ever sent).
export async function decideIdea(turn: Turn, draft: Draft, like: boolean) {
  await updateDraft(draft.id, { status: like ? "approved" : "skipped", approved_at: like ? new Date().toISOString() : null, waiting_for: null });
  await logAction({ restaurantId: draft.restaurant_id, draftId: draft.id, actor: "owner", action: like ? "approved" : "skipped", detail: `${like ? "Liked" : "Skipped"} the special idea` });
  await turn.send(like ? "👍 Noted. I'll keep ideas like this coming." : "👍 Skipped.");
}

// Skip, the GM's way: optional one-tap reasons, never a follow-up question (the next
// message isn't taken as a reason).
export async function offerSkipReasons(send: Send, draftId: string) {
  await updateDraft(draftId, { waiting_for: null });
  await send("👍 Skipped. If you like, tap why (it helps me learn):", { draftId, buttons: "reasons" });
}

export async function saveReasonTap(draft: Draft, n: number) {
  const reason = SKIP_REASONS[n - 1];
  if (reason) await saveSkipReason(draft, reason);
  return reason ?? null;
}
