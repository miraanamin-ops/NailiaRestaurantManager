import "server-only";
import { extractProfileChanges } from "@/lib/assistant";
import { logAction } from "@/lib/audit";
import { check, createDraft, saveSkipReason, updateDraft, type Draft } from "@/lib/drafts";
import { draftMessage } from "@/lib/format";
import type { Send } from "@/lib/google-jobs";
import { planProfileChanges, type ProfileChange } from "@/lib/onboarding/profile-changes";
import { applyProfileChanges } from "@/lib/profile-edits";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { ownerEventCard, ownerEventRow, type OwnerEvent } from "@/lib/feeds/owner-events";
import { dayLabel } from "@/lib/sales/format";
import type { Turn } from "@/lib/bot/turn";
import { alertBuilder } from "@/lib/builder-alerts";
import { getLearningContext } from "@/lib/drafts";
import { customerSummary, lookUpCustomers, lookUpReviews, reviewSummary } from "@/lib/claude-data";
import { assistantModeOf } from "./assistant-mode";
import { composeChecked, gmProfile, routeMessage } from "./gm";
import { buttonLabel, expectedLanguage, ON_IT_AFTER_MS, ON_IT_LINES, ROUTE_WORDS, SKIP_REASONS, type LanguageSeen, type Route, type RouterOutputType } from "./gm-rules";
import { asksAboutReviews, waitingReviewsText } from "./gm-review-rules";
import { recordAgentRun } from "./jobs";
import type { Usage } from "./usage";

// The GM live (see gmMode: allowed by AGENTS_LIVE_ALLOWED, once its checklist passes): it routes each owner
// message to the specialist (by that specialist's own mode: live = it answers;
// shadow = the old assistant answers, as before), answers simple profile questions
// itself, turns a fact about the restaurant into a confirm card, asks one question
// with buttons when a message is unclear, and sends one "on it" line when a reply
// won't be ready in about 8 seconds. With the restaurant on the agents
// (assistant-mode.ts) it also answers general chat and look-ups, finds the review
// an owner means, and takes typed changes to the draft on screen, and the old
// assistant never answers (oldAssistantRetired). Otherwise anything it doesn't
// handle goes to the old assistant (the caller falls back when it isn't handled).

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

// With every agent set live for this restaurant (scripts/assistant-mode.mjs), the
// old assistant is retired: it never answers. Back to "old" in one command.
export function oldAssistantRetired(r: Pick<Restaurant, "agent_modes">) {
  return assistantModeOf(r.agent_modes) === "agents";
}

export type GmLiveResult = { handled: boolean; route: Route | null };

// Routes the message and handles it if a live part of the system can. Not handled
// (route null: the router failed or took too long): the caller falls back.
export async function gmLive(turn: Turn, body: string, active: Draft | null, forcedRoute?: Route): Promise<GmLiveResult> {
  const { ctx, owner, send } = turn;
  const r = ctx.restaurant;
  const language = expectedLanguage({ ownerMessage: body });
  let route = forcedRoute ?? null;
  let request = body;
  let routed: RouterOutputType | null = null;
  if (!route) {
    const result = await routeMessage(r.id, owner, body, active);
    if (!result) return { handled: false, route: null };
    await logRoute(r, body, result.output.route, result.ms, result.usage);
    routed = result.output;
    route = routed.route;
    request = routed.request || body;
    if (route === "ambiguous") {
      await choiceCard(r, body, routed.question ?? "What would you like me to do?", routed.options, send);
      return { handled: true, route };
    }
  }
  return { handled: await dispatch(turn, body, request, route, language, { pasted: routed?.pasted_review ?? null, active }), route };
}

// The agents couldn't answer and the old assistant is retired: one honest line to
// the owner (never a guess), and the builder is told why (at most every 6 hours).
export async function agentsCouldNotHelp(turn: Turn, body: string, route: Route | null) {
  const r = turn.ctx.restaurant;
  const why = route ? `routed to ${ROUTE_WORDS[route]}, which couldn't answer it` : "the router didn't answer in time";
  await alertBuilder(
    `gm-fallback:${r.id}`,
    `${r.name}: the agents couldn't answer an owner message (${why}): "${body.slice(0, 80)}". The old assistant is retired there; if this keeps happening, switch back with: node --env-file=.env.local scripts/assistant-mode.mjs ${r.slug} old`,
  ).catch(() => "");
  await turn.send(COULD_NOT_HELP[expectedLanguage({ ownerMessage: body })]);
}

const COULD_NOT_HELP: Record<LanguageSeen, string> = {
  English: "Sorry, I couldn't do that one just now. Try saying it another way, or ask me about reviews, offers, Google posts, your numbers, the rota or your details.",
  "Roman Urdu": "Maaf kijiye, abhi yeh nahi ho saka. Dobara thore alag tareeqe se likhein, ya reviews, offers, Google posts, numbers, rota ya details ke baare mein poochein.",
  Urdu: "معاف کیجیے، ابھی یہ نہیں ہو سکا۔ دوبارہ تھوڑا مختلف لکھیں، یا ریویوز، آفرز، گوگل پوسٹس، نمبرز، روٹا یا تفصیلات کے بارے میں پوچھیں۔",
};

async function recordReply(r: Restaurant, kind: string, message: string, verdict: string | null, usage: Usage) {
  await recordAgentRun({ restaurantId: r.id, key: `gm:${kind}:${r.id}:${Date.now()}`, agent: "gm", kind: `gm_${kind}`, trigger: "owner_message", output: { message: message.slice(0, 120) }, agentVersion: "gm", verdict, usage }).catch(() => null);
}

const ownerOf = (r: Restaurant) => ({ owner_name: r.owner_name, language: r.owner_language, restaurant: r.name });

type DispatchExtra = { pasted?: RouterOutputType["pasted_review"]; active?: Draft | null };

async function dispatch(turn: Turn, body: string, request: string, route: Route, language: LanguageSeen, extra: DispatchExtra = {}): Promise<boolean> {
  const { ctx, send } = turn;
  const r = ctx.restaurant;
  // "Which reviews still need a reply?" (however it was routed): the list, from code.
  if (oldAssistantRetired(r) && ["chat", "profile_question", "reputation"].includes(route) && !extra.pasted && /\breview/i.test(body) && asksAboutReviews(body)) {
    await send(waitingReviewsText(ctx.reviews));
    return true;
  }
  switch (route) {
    case "profile_question": {
      const profile = await gmProfile(r.id);
      const reply = await composeChecked(r.id, { kind: "reply", owner: ownerOf(r), owner_message: body, profile: profile.fields }, "an owner question (live)");
      await recordReply(r, "reply", reply.message, reply.verdict, reply.usage);
      // A reply the checker didn't pass isn't sent.
      if (reply.verdict && reply.verdict !== "pass") return false;
      await send(reply.message);
      return true;
    }
    // General chat and look-ups (with the old assistant retired): the composer
    // answers from the profile and short summaries (counts, the latest reviews,
    // first names of birthdays this week; never contact details), checked.
    case "chat": {
      if (!oldAssistantRetired(r)) return false;
      const profile = await gmProfile(r.id);
      const lookups = {
        reviews: reviewSummary(ctx.reviews, ctx.now),
        latest_reviews: lookUpReviews(ctx.reviews, { limit: 5 }).map((x) => ({ author: x.author, rating: x.rating, date: x.date, text: x.text?.slice(0, 160) ?? null, replied: x.replied })),
        customers: customerSummary(ctx.customers, ctx.now),
        birthdays_next_7_days: lookUpCustomers(ctx.customers, { birthday_within_days: 6 }, ctx.now).map((c) => c.name.split(/\s+/)[0]),
      };
      const reply = await withOnIt(composeChecked(r.id, { kind: "reply", owner: ownerOf(r), owner_message: body, profile: profile.fields, lookups }, "an owner message (chat, live)"), send, language);
      await recordReply(r, "chat", reply.message, reply.verdict, reply.usage);
      if (reply.verdict && reply.verdict !== "pass") return false;
      await send(reply.message);
      return true;
    }
    case "reputation": {
      const { reputationMode } = await import("./reputation");
      if (reputationMode(r) !== "live") return false;
      const { reputationRequest } = await import("./gm-reputation");
      return withOnIt(reputationRequest(turn, body, extra.pasted ?? null), send, language);
    }
    case "edit":
      return editOnScreen(turn, body, extra.active ?? null);
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
    // The staff team and the rota, in the owner's own words.
    case "team": {
      const { handleTeamMessage } = await import("@/lib/rota/understand");
      return handleTeamMessage(r, body, { now: ctx.now, send });
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
  const handled = await dispatch(turn, input.message, input.message, option.route, expectedLanguage({ ownerMessage: input.message }), { active: null });
  // Not handled live (chat, a specialist in shadow): today's assistant answers the original message.
  return handled ? { handled: true as const } : { handled: false as const, message: input.message };
}

// ---------- A typed change to the draft on screen ----------

// The same paths as after tapping Edit: the rota is re-filled, a fact card read
// again, a campaign or message rewritten and checked again (and a Google reply or
// post is checked by the checker again before it can go out).
async function editOnScreen(turn: Turn, body: string, active: Draft | null) {
  const { ctx, send } = turn;
  if (!active || active.waiting_for !== "decision") return false;
  if (["review_question", "hours_question", "agent_question", "choice", "special_idea"].includes(active.kind)) return false;
  if (active.kind === "rota") {
    const { reviseRota } = await import("@/lib/rota/build");
    await reviseRota(ctx.restaurant, active, body, { now: ctx.now, send, useClaude: true });
    return true;
  }
  if (active.kind === "profile_change") {
    await correctFact(turn, active, body);
    return true;
  }
  const { reviseAndSend, reviseCampaignAndSend } = await import("@/lib/bot/flows");
  if (active.kind === "email_campaign") {
    await reviseCampaignAndSend(ctx, active, body, send);
    return true;
  }
  const { rewriteDraft } = await import("@/lib/assistant");
  const rewritten = await rewriteDraft(ctx, await getLearningContext(ctx.restaurantId), active, body);
  await reviseAndSend(ctx, active, body, rewritten, send);
  return true;
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

// An event the owner told today's assistant about: a confirm card of the same kind
// (owner only, never sent), saved to the restaurant's own calendar on Approve.
export async function localEventCard(turn: Turn, body: string, event: OwnerEvent) {
  const r = turn.ctx.restaurant;
  const draft = await createDraft({ restaurantId: r.id, kind: "profile_change", content: ownerEventCard(event, (d) => dayLabel(d, Number(d.slice(0, 4)))), audience: "your local calendar", request: body, checks: {}, mode: "present", actor: "assistant", agentInput: { local_event: event } });
  await turn.send(draftMessage(draft, r), true);
}

// Approve on a fact card: the change is saved (UNDO puts it back).
export async function approveFact(turn: Turn, draft: Draft) {
  const input = (draft as Draft & { agent_input?: { changes?: ProfileChange[]; local_event?: OwnerEvent } }).agent_input ?? {};
  if (input.local_event) {
    await updateDraft(draft.id, { status: "approved", approved_at: new Date().toISOString(), waiting_for: null });
    const { upsertCalendar } = await import("@/lib/feeds/store");
    await upsertCalendar([ownerEventRow(input.local_event, turn.ctx.restaurant, draft.id)]);
    await logAction({ restaurantId: draft.restaurant_id, draftId: draft.id, actor: "owner", action: "outside_data", detail: `Added ${input.local_event.name} (${input.local_event.day}) to the local calendar`, data: { event: input.local_event } });
    await turn.send(`👍 Added ${input.local_event.name} to your calendar.`);
    return;
  }
  const changes = (input.changes ?? []) as ProfileChange[];
  await updateDraft(draft.id, { status: "approved", approved_at: new Date().toISOString(), waiting_for: null });
  const restaurant = check(await getSupabase().from("restaurants").select("*").eq("id", turn.ctx.restaurantId).single<Restaurant>())!;
  await turn.send(await applyProfileChanges(restaurant, changes));
}

// Edit on a fact card: the owner's correction is read again, as a new card.
export async function correctFact(turn: Turn, draft: Draft, correction: string) {
  await updateDraft(draft.id, { status: "superseded", waiting_for: null });
  if ((draft as Draft & { agent_input?: { local_event?: OwnerEvent } }).agent_input?.local_event) {
    await turn.send("OK, not saved. Tell me again with the right details, e.g. _there's a fair in the park on Saturday 24 October_.");
    return;
  }
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
  if (input.agent === "insights") {
    const { insightsMode, answerWithInsights } = await import("./insights");
    if ((await insightsMode(turn.ctx.restaurant)) === "live") {
      const question = `You asked: ${draft.content}\nThe owner answered: ${answer}\nTake this into account and tell the owner briefly what it changes.`;
      if (await withOnIt(answerWithInsights(turn.ctx.restaurant, question, turn.ctx.now, turn.send), turn.send, expectedLanguage({ ownerMessage: answer }))) return;
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
