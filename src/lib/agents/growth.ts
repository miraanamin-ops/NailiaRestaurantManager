import "server-only";
import { randomUUID } from "node:crypto";
import { logAction } from "@/lib/audit";
import { createCampaignDraft, londonSendAt, recipientsFor } from "@/lib/campaigns";
import { checkResult, type DraftChecks } from "@/lib/checks/types";
import { misleadingClaims } from "@/lib/checks/compliance";
import { moneyAtDraft } from "@/lib/checks/money";
import { londonYmd } from "@/lib/clock";
import { draftPreviewUrl } from "@/lib/email/previews";
import { draftMessage } from "@/lib/format";
import { entriesToDraft } from "@/lib/local-calendar-rules";
import { syncBankHolidays } from "@/lib/local-calendar";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { addDays } from "@/lib/sales/format";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { agentLiveAllowed, effectiveAgentMode } from "@/lib/switches";
import { londonToday } from "./checker-core";
import { confirmedFields, goLiveChecklist } from "./go-live";
import { gmIsLive, holdAgentQuestion, holdSpecialIdea } from "./gm-held";
import { growthLoop, type GrowthInput, type GrowthOutcome } from "./growth-core";
import { growthPreviewPng } from "./growth-preview";
import { campaignFieldsFrom, growthText, type GrowthDraftOutput } from "./growth-rules";
import { loadMetricsData } from "./insights";
import { enqueueAgentJob, recordAgentRun, type AgentJob, type JobOutcome } from "./jobs";
import type { LoopOutcome } from "./loop";
import { agentMode } from "./modes";
import { quietTimes } from "./quiet-times";
import { callTool } from "./tools";
import type { CheckerVerdictOutput } from "./schema";

// The Growth agent with the database: its input (profile, segments, history,
// the local calendar, quiet times from sales), the checker's data (with a picture
// of each email), shadow mode (owner requests, the weekly birthday batch, the
// Monday plan, calendar dates, special ideas; saved in shadow_drafts for /log), and
// live mode (see growthMode): owner requests answered by Growth, Monday drafts
// held for the brief. Special ideas stay draft only (shadow) for now.

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// Live only when AGENTS_LIVE_ALLOWED lets it (lib/switches.ts) and the go-live
// checklist passes (discount cap, offer types, sign-up offer, logo, colours).
export async function growthMode(restaurant: Restaurant) {
  const mode = agentMode(restaurant, "growth");
  if (mode !== "live") return mode;
  const liveAllowed = agentLiveAllowed(process.env, "growth");
  return effectiveAgentMode(mode, { liveAllowed, ready: liveAllowed && goLiveChecklist(restaurant, "growth", await confirmedFields(restaurant.id)).ready });
}

export type GrowthJob = {
  task: GrowthInput["task"];
  request?: string | null;
  // "YYYY-MM-DD": the restaurant's date when the job was made.
  today: string;
  // calendar: the date this job is about.
  entry?: { day: string; name: string; type: string; date_uncertain: boolean } | null;
  legacy_draft_id?: string | null;
  legacy_text?: string | null;
};

export async function growthInput(restaurant: Restaurant, job: GrowthJob): Promise<GrowthInput> {
  const now = new Date(`${job.today}T12:00:00Z`);
  const [profile, segments, history, calendar, metrics] = await Promise.all([
    callTool("growth", "get_profile", restaurant.id, {}),
    callTool("growth", "get_segments", restaurant.id, { now }),
    callTool("growth", "get_campaign_history", restaurant.id, {}),
    job.task === "calendar" ? Promise.resolve([]) : callTool("growth", "get_local_calendar", restaurant.id, { from: job.today, to: addDays(job.today, 21) }),
    loadMetricsData(restaurant.id, job.today).catch(() => null),
  ]);
  return {
    task: job.task,
    request: job.request ?? null,
    profile,
    segments,
    history,
    calendar: job.task === "calendar" && job.entry ? [job.entry] : calendar.map(({ day, name, type, date_uncertain }) => ({ day, name, type, date_uncertain })),
    quiet_times: metrics ? quietTimes(metrics) : null,
    today: job.today,
    today_words: londonToday(now),
    send_window: { start: restaurant.send_window_start, end: restaurant.send_window_end },
  };
}

export async function runGrowthFor(restaurant: Restaurant, job: GrowthJob, label: string) {
  const input = await growthInput(restaurant, job);
  const [checkerProfile, recent] = await Promise.all([
    callTool("checker", "get_profile", restaurant.id, {}),
    callTool("checker", "get_recent_outputs", restaurant.id, { kind: "email_campaign", excludeDraftId: null }),
  ]);
  const started = Date.now();
  const outcome = await growthLoop(
    input,
    { resolve: (refs) => callTool("checker", "resolve_sources", restaurant.id, { refs }), checkerProfile, recent, preview: (d) => growthPreviewPng(restaurant, d) },
    label,
  );
  return { outcome, input, profileVersion: input.profile.version, ms: Date.now() - started };
}

const TASK_WORDS: Record<GrowthInput["task"], string> = {
  owner_request: "the owner's request",
  weekly_plan: "the Monday plan",
  calendar: "a calendar date",
  birthdays: "the birthday batch",
  special_ideas: "special ideas",
};

export function growthOutcomeLine(outcome: GrowthOutcome) {
  if (!outcome.drafts.length) return "would propose nothing this week";
  return outcome.drafts
    .map((d) => {
      const rev = d.revisions ? ` after ${d.revisions} revision${d.revisions === 1 ? "" : "s"}` : "";
      if (d.kind === "reply") return `would draft ${d.output.type === "special_idea" ? "a special idea" : `"${d.output.content.subject}"`} (checker ${d.checker.verdict}${rev})`;
      return `would ask the owner${d.by === "checker" ? ` (the checker escalated${rev})` : ""}: ${d.question}`;
    })
    .join("; ");
}

// ---------- Shadow mode ----------

// Queued next to today's work (or for new work). Never throws.
export async function queueGrowthShadow(restaurant: Restaurant, job: GrowthJob, key?: string) {
  try {
    if ((await growthMode(restaurant)) !== "shadow") return null;
    const trigger = { owner_request: "owner_request", weekly_plan: "weekly_plan_monday", calendar: "calendar_lookahead", birthdays: "birthday_check_daily", special_ideas: "weekly_plan_monday" }[job.task];
    return await enqueueAgentJob({ restaurantId: restaurant.id, key: key ?? `growth:${job.task}:${randomUUID()}`, agent: "growth", kind: "growth_shadow", trigger, input: job as Record<string, unknown> });
  } catch (err) {
    console.error("Couldn't queue Growth in shadow mode", err);
    return null;
  }
}

// One shadow row per draft (or one "nothing this week" row for an empty plan).
async function saveShadow(restaurant: Restaurant, job: AgentJob | null, input: GrowthJob, outcome: GrowthOutcome, profileVersion: number, ms: number) {
  const subject = { request: input.request ?? null, entry: input.entry ?? null, today: input.today, ms };
  const base = { restaurant_id: restaurant.id, agent: "growth", agent_version: outcome.agentVersion, job_id: job?.id ?? null, source: input.task, task: input.task, legacy_draft_id: input.legacy_draft_id ?? null, legacy_text: input.legacy_text ?? null, profile_version: profileVersion };
  const rows: Record<string, unknown>[] = outcome.drafts.length
    ? outcome.drafts.map((d: LoopOutcome<GrowthDraftOutput>, i) => ({
        ...base,
        // Only the first draft sits next to today's work; a second option is new work.
        legacy_text: i === 0 ? base.legacy_text : null,
        legacy_draft_id: i === 0 ? base.legacy_draft_id : null,
        checker_version: d.checkerVersion,
        subject: { ...subject, option: outcome.drafts.length > 1 ? i + 1 : null },
        outcome: d.kind,
        output: d.output,
        question: d.kind === "question" ? d.question : null,
        checker: d.checker,
        revisions: d.revisions,
        steps: d.steps,
      }))
    : [{ ...base, checker_version: null as string | null, subject: { ...subject, option: null }, outcome: "none", output: {}, question: null, checker: null, revisions: 0, steps: [] }];
  ok(await getSupabase().from("shadow_drafts").insert(rows));
}

export async function runGrowthShadow(job: AgentJob): Promise<JobOutcome> {
  const input = job.input as unknown as GrowthJob;
  const restaurant = ok(await getSupabase().from("restaurants").select("*").eq("id", job.restaurant_id).single<Restaurant>());
  if (!restaurant) throw new Error("Restaurant not found");
  const { outcome, profileVersion, ms } = await runGrowthFor(restaurant, input, `${TASK_WORDS[input.task]} (shadow)`);
  await saveShadow(restaurant, job, input, outcome, profileVersion, ms);
  const verdicts = outcome.drafts.map((d) => (d.kind === "reply" ? d.checker.verdict : "question"));
  return {
    output: { drafts: outcome.drafts.length, verdicts, ms },
    agentVersion: outcome.agentVersion,
    verdict: verdicts.join(",") || "none",
    usage: outcome.usage,
    actor: "growth",
    action: "agent_drafted",
    detail: `Growth (shadow, v${outcome.agentVersion}) on ${TASK_WORDS[input.task]}${input.request ? ` ("${input.request.slice(0, 60)}")` : input.entry ? ` (${input.entry.name})` : ""}: ${growthOutcomeLine(outcome)}`,
  };
}

// ---------- Mondays: the plan, calendar dates 2 to 3 weeks ahead, special ideas ----------

// Never throws: the morning job carries on. Live: the plan's and calendar's drafts
// are held for the brief. Special ideas stay in shadow (draft only) for now.
export async function mondayGrowth(restaurant: Restaurant, today: string) {
  try {
    const mode = await growthMode(restaurant);
    if (mode === "off") return [];
    await syncBankHolidays(today);
    const queued: string[] = [];
    const queue = async (job: GrowthJob, key: string) => {
      const done = mode === "live" && job.task !== "special_ideas" ? await liveGrowthMonday(restaurant, job, key) : await queueGrowthShadow(restaurant, job, key);
      if (done) queued.push(job.entry?.name ?? job.task);
    };
    await queue({ task: "weekly_plan", today }, `growth:plan:${today}`);
    const entries = entriesToDraft(await callTool("growth", "get_local_calendar", restaurant.id, { from: addDays(today, 14), to: addDays(today, 21) }), today);
    for (const e of entries) {
      await queue({ task: "calendar", today, entry: { day: e.day, name: e.name, type: e.type, date_uncertain: e.date_uncertain } }, `growth:calendar:${e.day}:${e.name}`.slice(0, 200));
    }
    if (mode === "shadow") await queueGrowthShadow(restaurant, { task: "special_ideas", today }, `growth:ideas:${today}`);
    // Live special ideas need the GM live, which brings them to the brief as Draft-only cards.
    else if (await gmIsLive(restaurant)) {
      if (await liveGrowthMonday(restaurant, { task: "special_ideas", today }, `growth:ideas:live:${today}`)) queued.push("special_ideas");
    }
    return queued;
  } catch (err) {
    console.error("Growth's Monday steps failed", err);
    return [];
  }
}

// The weekly birthday email: in shadow, Growth's batch sits next to today's (only
// when someone has a birthday). Live: Growth's batch replaces it (held for the brief).
export async function birthdayGrowth(restaurant: Restaurant, today: string, legacy: { draftId: string | null; text: string | null }) {
  const mode = await growthMode(restaurant);
  const job: GrowthJob = { task: "birthdays", today, legacy_draft_id: legacy.draftId, legacy_text: legacy.text };
  if (mode === "shadow") return queueGrowthShadow(restaurant, job, `growth:birthdays:${today}`);
  return null;
}

// ---------- Live mode (see growthMode) ----------

// The draft's checks for the approval card: the checker's minor fixes, and the code
// checks (misleading claims; the cap from the offer's fields and the wording).
export function growthChecks(d: GrowthDraftOutput, verdict: CheckerVerdictOutput, restaurant: Pick<Restaurant, "discount_cap_percent" | "menu" | "birthday_offer" | "signup_reward">): DraftChecks {
  const fixesFor = (prefix: string) => verdict.minor_fixes.filter((f) => f.check.startsWith(prefix)).map((f) => `"${f.find}" → "${f.replace}"`);
  const text = growthText(d);
  return {
    tone: checkResult(fixesFor("T"), []),
    facts: checkResult(fixesFor("F"), []),
    compliance: checkResult([], misleadingClaims(text)),
    money: checkResult([], moneyAtDraft(text, restaurant.discount_cap_percent, d.offer ? { details: d.offer, menu: restaurant.menu, owner: { birthday_offer: restaurant.birthday_offer, signup_reward: restaurant.signup_reward } } : null)),
  };
}

// Saves Growth's finished campaign as a real campaign draft (with its offer's fields).
async function saveLiveDraft(restaurant: Restaurant, d: LoopOutcome<GrowthDraftOutput> & { kind: "reply" }, request: string, mode: "present" | "hold", jobId: string | null) {
  const out = d.output;
  const { draft } = await createCampaignDraft({
    restaurant,
    fields: campaignFieldsFrom(out),
    offerDetails: out.offer,
    sendAt: londonSendAt(out.send_at),
    request,
    checks: growthChecks(out, d.checker, restaurant),
    now: new Date(),
    isBirthday: out.type === "birthday_batch",
    mode,
    actor: "growth",
    agentCheck: { mode: "live", job_id: jobId ?? "", agent_version: d.checkerVersion, draft_version: 1, verdict: "pass", checks: d.checker.checks, minor_fixes: d.checker.minor_fixes, owner_question: null, notes: d.checker.notes, at: new Date().toISOString() },
  });
  return draft;
}

async function recordLive(restaurant: Restaurant, job: GrowthJob, key: string, outcome: GrowthOutcome, ms: number) {
  const verdicts = outcome.drafts.map((d) => (d.kind === "reply" ? d.checker.verdict : "question"));
  const jobId = await recordAgentRun({ restaurantId: restaurant.id, key, agent: "growth", kind: "growth_live", trigger: job.task, output: { drafts: outcome.drafts.length, verdicts, ms }, agentVersion: outcome.agentVersion, verdict: verdicts.join(",") || "none", usage: outcome.usage });
  await logAction({
    restaurantId: restaurant.id,
    actor: "growth",
    action: "agent_drafted",
    detail: `Growth (live, v${outcome.agentVersion}) on ${TASK_WORDS[job.task]}: ${growthOutcomeLine(outcome).replaceAll("would ", "")}`,
    data: { job_key: key, kind: "growth_live" },
    job: { jobId, agent: "growth", agentVersion: outcome.agentVersion, verdict: verdicts.join(",") || "none" },
  });
  return jobId;
}

// Live: Growth answers the owner's ask for an offer (instead of today's campaign
// flow). Returns false if it couldn't (today's flow answers instead).
export async function liveGrowthRequest(restaurant: Restaurant, request: string, now: Date, send: (text: string, buttons?: boolean, mediaUrl?: string | null) => Promise<unknown>) {
  const job: GrowthJob = { task: "owner_request", request, today: londonYmd(now) };
  const key = `growth:request:live:${Date.now()}`;
  try {
    const { outcome, ms } = await runGrowthFor(restaurant, job, "the owner's request (live)");
    const jobId = await recordLive(restaurant, job, key, outcome, ms);
    for (const d of outcome.drafts) {
      if (d.kind === "question") {
        await send(`❓ ${d.question}`);
        continue;
      }
      const draft = await saveLiveDraft(restaurant, d, request, "present", jobId);
      if (draft.waiting_for === "decision") await send(draftMessage(draft, restaurant), true, draftPreviewUrl(draft));
    }
    return outcome.drafts.length > 0;
  } catch (err) {
    console.error("Growth couldn't answer the request; today's campaign flow answers instead", err);
    return false;
  }
}

// Live Monday work: drafts held for the brief. With the GM live, a question and a
// special idea are held for the brief too (otherwise a question is only recorded);
// nothing is messaged from here.
async function liveGrowthMonday(restaurant: Restaurant, job: GrowthJob, key: string) {
  const seen = ok(await getSupabase().from("agent_jobs").select("id").eq("restaurant_id", restaurant.id).eq("job_key", key).maybeSingle<{ id: string }>());
  if (seen) return null;
  try {
    const { outcome, ms } = await runGrowthFor(restaurant, job, `${TASK_WORDS[job.task]} (live)`);
    const jobId = await recordLive(restaurant, job, key, outcome, ms);
    const request = job.task === "calendar" ? `${job.entry?.name} is coming up` : "This week's plan";
    const gm = await gmIsLive(restaurant);
    for (const d of outcome.drafts) {
      if (d.kind === "question") {
        if (gm) await holdAgentQuestion(restaurant, "growth", d.question, { task: job.task, request });
      } else if (d.output.type === "special_idea") {
        if (gm) await holdSpecialIdea(restaurant, growthText(d.output));
      } else await saveLiveDraft(restaurant, d, request, "hold", jobId);
    }
    return jobId;
  } catch (err) {
    console.error("Growth's live Monday work failed", err);
    return null;
  }
}

// Live: the weekly birthday batch from Growth instead of today's (held for the brief).
// Returns true if Growth handled it.
export async function liveGrowthBirthdays(restaurant: Restaurant, today: string) {
  if ((await growthMode(restaurant)) !== "live") return false;
  const { eligible } = await recipientsFor(restaurant, "birthdays_7d", new Date(), { isBirthday: true });
  if (!eligible.length) return true;
  const job: GrowthJob = { task: "birthdays", today };
  const key = `growth:birthdays:live:${today}`;
  try {
    const { outcome, ms } = await runGrowthFor(restaurant, job, "the birthday batch (live)");
    const jobId = await recordLive(restaurant, job, key, outcome, ms);
    const channel = ownerChannel(restaurant);
    for (const d of outcome.drafts) {
      if (d.kind === "reply") await saveLiveDraft(restaurant, d, "Weekly birthday email", "hold", jobId);
      // No birthday offer yet: Growth asks the owner once (the birthday email waits for it).
      else if (channel) await messageOwner(channel, `🎂 ${d.question}`);
    }
    return true;
  } catch (err) {
    console.error("Growth couldn't write the birthday batch; today's birthday email goes instead", err);
    return false;
  }
}
