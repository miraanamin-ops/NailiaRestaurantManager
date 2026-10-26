import "server-only";
import { loadRestaurantContext } from "@/lib/assistant";
import { AGENT_HANDLERS } from "@/lib/agents/handlers";
import { agentQueueHandler } from "@/lib/agents/jobs";
import { gmMode } from "@/lib/agents/gm";
import { releaseAlerts } from "@/lib/agents/gm-brief";
import { alertBuilder } from "@/lib/builder-alerts";
import { londonWeekday, londonYmd } from "@/lib/clock";
import { runFeedbackJob } from "@/lib/feedback";
import { ownerChannel } from "@/lib/followups";
import { runReviewCheck } from "@/lib/google-jobs";
import { runMorningStep, type MorningCarry } from "@/lib/morning";
import { messageOwner } from "@/lib/notify";
import { backfillJob } from "@/lib/feeds/backfill";
import { clearFeedCache, FEED_JOB_HANDLERS } from "@/lib/feeds/jobs";
import { checkFeedHealth } from "@/lib/feeds/status";
import { processQueue } from "@/lib/send";
import { OwnerToldError, SORRY } from "@/lib/sorry";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { checkLateBriefs, checkQueueHealth } from "./health";
import { PermanentJobError, type JobHandler } from "./registry";
import { enqueueMorningStep } from "./dispatch";
import { isMorningStep, nextMorningStep } from "./rules";
import { cleanup, type QueueJob } from "./store";

// Every job type the app's workers run, and what runs it. To add a type (e.g.
// forecast, rota, finance): add its row to job_types in a numbered SQL file,
// then register it here. Types run by the Python service have runner
// 'external' in job_types and no handler here.

async function restaurantFor(job: QueueJob) {
  if (!job.restaurant_id) throw new PermanentJobError("This job has no restaurant");
  const { data, error } = await getSupabase().from("restaurants").select("*").eq("id", job.restaurant_id).maybeSingle<Restaurant>();
  if (error) throw new Error(error.message);
  return data;
}

// A WhatsApp message to answer. kind: owner (or an owner still setting up) or staff.
export type OwnerMessagePayload = {
  kind: "owner" | "staff";
  owner: string; // who sent it (the owner's or staff member's number)
  sandbox: string; // our number they wrote to
  body: string;
  buttonPayload?: string;
  media?: { url: string; contentType: string }[];
};

const ownerMessage: JobHandler = {
  run: async (job) => {
    const p = job.payload as OwnerMessagePayload;
    const restaurantId = job.restaurant_id!;
    const media = p.media ?? [];
    if (p.kind === "staff") {
      const { handleStaffMessage } = await import("@/lib/sales/whatsapp");
      await handleStaffMessage({ restaurantId, staffNumber: p.owner, sandbox: p.sandbox, body: p.body, media: media[0] ?? null });
      return { handled: "staff" };
    }
    // A restaurant still being set up gets the onboarding conversation instead.
    const { handleOnboardingMessage, onboardingInProgress } = await import("@/lib/onboarding/whatsapp-flow");
    if (await onboardingInProgress(restaurantId)) {
      await handleOnboardingMessage({ restaurantId, owner: p.owner, sandbox: p.sandbox, body: p.body, media });
      return { handled: "onboarding" };
    }
    const { handleMessage } = await import("@/lib/bot");
    await handleMessage({ restaurantId, owner: p.owner, sandbox: p.sandbox, body: p.body, buttonPayload: p.buttonPayload, media: media[0] ?? null });
    return { handled: "owner" };
  },
  // One try only: a retry could answer the owner twice. If it died without the
  // owner hearing anything (a crash, a timeout), they get the usual "Sorry" now,
  // once. The builder is told by the worker either way.
  onDead: async (job, err) => {
    if (err instanceof OwnerToldError) return;
    const p = job.payload as OwnerMessagePayload;
    if (!job.restaurant_id || !p?.owner || !p?.sandbox) return;
    await messageOwner({ restaurantId: job.restaurant_id, from: p.sandbox, to: p.owner }, SORRY);
  },
};

// One step of the morning job, then the next step is queued (lib/morning.ts).
const morning: JobHandler = {
  alertFirstFailure: true,
  run: async (job) => {
    const step = job.payload.step;
    const day = String(job.payload.day ?? "");
    if (!isMorningStep(step)) throw new PermanentJobError(`Unknown morning step ${String(step)}`);
    const r = await restaurantFor(job);
    if (!r?.active) return { skipped: "restaurant not active" };
    const now = new Date();
    // A step retried past midnight belongs to a day that's over: the new day has its own.
    if (londonYmd(now) !== day) return { skipped: `that morning (${day}) is over` };
    const out = await runMorningStep(r, step, now, (job.payload.carry as MorningCarry) ?? {});
    const next = nextMorningStep(step, londonWeekday(now));
    if (next) await enqueueMorningStep(r.id, day, next, now, out.carry);
    return { step, done: out.done, next, ...(out.brief !== undefined ? { brief: out.brief as Record<string, unknown> } : {}) };
  },
};

// Hourly: new Google reviews (1 to 3 stars alert the owner; 4 to 5 wait for the brief).
const reviewCheck: JobHandler = {
  run: async (job) => {
    const r = await restaurantFor(job);
    const channel = r?.active ? ownerChannel(r) : null;
    if (!r || !channel) return { skipped: "no owner WhatsApp yet" };
    const ctx = await loadRestaurantContext(r.id, { realTime: true });
    const result = await runReviewCheck(ctx, (text, withButtons) => messageOwner(channel, text, withButtons));
    // A review whose reply couldn't be drafted isn't marked handled: the retry picks it up.
    if (result.failed) throw new Error(`${result.failed} review(s) couldn't be handled`);
    return result;
  },
};

// Hourly, the GM live: an alert held for quiet hours or the one-an-hour limit, if one is due.
const gmAlerts: JobHandler = {
  run: async (job) => {
    const r = await restaurantFor(job);
    const channel = r?.active ? ownerChannel(r) : null;
    if (!r || !channel || (await gmMode(r)) !== "live") return { skipped: "the GM isn't live" };
    return { released: await releaseAlerts(r, (text, withButtons) => messageOwner(channel, text, withButtons), new Date()) };
  },
};

// Hourly: "How was your visit?" emails that are due (about 3 hours after a redemption).
const feedback: JobHandler = {
  run: async (job) => {
    const r = await restaurantFor(job);
    if (!r?.active) return { skipped: "restaurant not active" };
    const s = await runFeedbackJob(r, new Date());
    // A failed send isn't retried here (it's marked failed); the builder hears about it.
    if (s.failed) await alertBuilder(`feedback-failed:${r.id}`, `${r.name}: ${s.failed} "How was your visit?" email(s) failed to send.`);
    return s;
  },
};

// Hourly: approved campaigns whose send time has come (and anything else held
// that's now due). Quiet: the results are in the activity log and the next brief.
const releaseSends: JobHandler = {
  run: async (job) => {
    const r = await restaurantFor(job);
    if (!r?.active) return { skipped: "restaurant not active" };
    return { released: (await processQueue(r, new Date())).map((x) => x.outcome) };
  },
};

// The old hourly weather job: the weather feed (feed_weather, 04:30 and 06:45
// UK) does this now. Kept so jobs queued before the change finish quietly.
const weather: JobHandler = {
  run: async () => ({ skipped: "moved to the weather feed (feed_weather)" }),
};

// 9:31 UK: briefs that haven't gone, and the queue's own health.
const healthCheck: JobHandler = {
  run: async () => {
    const now = new Date();
    return { lateBriefs: await checkLateBriefs(now), queue: await checkQueueHealth(now), feeds: await checkFeedHealth(now) };
  },
};

// Daily: old finished and dead jobs (lib/queue/config.ts RETENTION).
const cleanupJob: JobHandler = {
  run: async () => ({ removed: await cleanup(), feedCache: await clearFeedCache() }),
};

// Thursday 10am: next week's rota, sent to the owner as a draft (lib/rota/build.ts).
// A week that already has a draft (or is approved) is left alone.
const rotaWeekJob: JobHandler = {
  run: async (job) => {
    const r = await restaurantFor(job);
    const channel = r?.active ? ownerChannel(r) : null;
    if (!r || !channel) return { skipped: "no owner WhatsApp yet" };
    const { suggestRota } = await import("@/lib/rota/build");
    return suggestRota(r, { now: new Date(), send: (text, withButtons = false, mediaUrl = null) => messageOwner(channel, text, withButtons, { mediaUrl }), mode: "urgent", actor: "scheduled job", rebuild: false });
  },
};

export const HANDLERS: Record<string, JobHandler> = {
  owner_message: ownerMessage,
  rota_week: rotaWeekJob,
  morning,
  agent: agentQueueHandler(AGENT_HANDLERS),
  review_check: reviewCheck,
  gm_alerts: gmAlerts,
  feedback,
  release_sends: releaseSends,
  weather,
  health_check: healthCheck,
  cleanup: cleanupJob,
  ...FEED_JOB_HANDLERS,
  feed_backfill: backfillJob,
};
