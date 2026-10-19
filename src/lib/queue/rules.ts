// The queue's rules in plain code (no database), unit-tested in tests/queue.test.ts:
// priorities, the morning steps and their order, and job keys.
import { londonMinutes, londonParts, londonTime, londonWeekday, londonYmd } from "@/lib/clock";
import { BRIEF_DUE, type NightlyModel, PRIORITY } from "./config";

export const briefDueMinutes = BRIEF_DUE.hour * 60 + BRIEF_DUE.minute;

// Owner replies first, then morning steps queued before 9:30, then everything else.
// Within the morning, a later step goes first (the brief is 5 above the first
// step), so restaurants finish one by one instead of all moving a step at a time
// and all finishing last.
export function priorityFor(type: string, now: Date, step?: MorningStep) {
  if (type === "owner_message") return PRIORITY.owner;
  const ahead = type === "morning" && step ? Math.max(0, MORNING_STEPS.indexOf(step)) : 0;
  if (type === "morning" && londonMinutes(now) < briefDueMinutes) return PRIORITY.morningEarly - ahead;
  return PRIORITY.normal - ahead;
}

// The morning job's steps, in the order they have always run. Each step is its
// own job; the next one is queued only once the step before it has worked, so
// the brief always comes last.
//   release   approved sends held overnight go out
//   birthday  Monday: this week's birthday email
//   post      Monday and Thursday: a Google post
//   report    Monday: last week's report
//   monday    Monday: Visibility (bank holiday hours) and Growth (the week's plan)
//   brief     the brief itself (plus the report headline on Mondays)
export const MORNING_STEPS = ["release", "birthday", "post", "report", "monday", "brief"] as const;
export type MorningStep = (typeof MORNING_STEPS)[number];

// The steps that apply on this weekday (1 = Monday ... 7 = Sunday).
export function morningStepsFor(weekday: number): MorningStep[] {
  return MORNING_STEPS.filter((s) => {
    if (s === "birthday" || s === "report" || s === "monday") return weekday === 1;
    if (s === "post") return weekday === 1 || weekday === 4;
    return true;
  });
}

export function nextMorningStep(step: MorningStep, weekday: number): MorningStep | null {
  const steps = morningStepsFor(weekday);
  return steps[steps.indexOf(step) + 1] ?? null;
}

export function isMorningStep(s: unknown): s is MorningStep {
  return typeof s === "string" && (MORNING_STEPS as readonly string[]).includes(s);
}

// Keys: the same work queued twice (the hourly job and its daily backup, a
// Twilio retry) is one job.
export const keys = {
  hourly: (type: string, restaurantId: string, now: Date) => `${type}:${restaurantId}:${now.toISOString().slice(0, 13)}`,
  morning: (restaurantId: string, day: string, step: MorningStep) => `morning:${restaurantId}:${day}:${step}`,
  ownerMessage: (messageSid: string) => `owner_message:${messageSid}`,
  agent: (jobKey: string) => `agent:${jobKey}`,
  health: (day: string) => `health_check:${day}:brief`,
  cleanup: (day: string) => `cleanup:${day}`,
  model: (model: string, restaurantId: string, day: string) => `${model}:${restaurantId}:${day}`,
};

// One restaurant's morning steps never run at the same time, and neither do
// two of its WhatsApp messages (so they're answered in order).
export const concurrencyKeys = {
  morning: (restaurantId: string) => `morning:${restaurantId}`,
  whatsapp: (restaurantId: string) => `whatsapp:${restaurantId}`,
  // A restaurant's analytics models run one at a time.
  models: (restaurantId: string) => `models:${restaurantId}`,
};

// The morning chain for a restaurant starts with this step today.
export function firstMorningStep(now: Date): { day: string; step: MorningStep } {
  return { day: londonYmd(now), step: morningStepsFor(londonWeekday(now))[0] };
}

// When the 9:30 check runs: a minute after the brief is due, on this UK day.
export function briefCheckTime(now: Date) {
  const p = londonParts(now);
  return londonTime(p.year, p.month, p.day, BRIEF_DUE.hour, BRIEF_DUE.minute + 1);
}

// What the hourly job (or its daily backup) queues for one active restaurant.
export type PlannedJob = { type: string; key: string; priority: number; concurrencyKey?: string; payload?: Record<string, unknown>; runAt?: Date };

export function plannedJobs(
  r: { id: string; hasOwnerChannel: boolean },
  job: "hourly" | "daily",
  now: Date,
  morningGateResult: string | null,
  // The analytics service's nightly models (empty while ANALYTICS_JOBS is off).
  models: readonly NightlyModel[] = [],
): PlannedJob[] {
  const out: PlannedJob[] = [];
  const add = (type: string, key: string, extra: Partial<PlannedJob> = {}) => out.push({ type, key, priority: priorityFor(type, now), ...extra });
  if (job === "hourly") {
    if (r.hasOwnerChannel) {
      add("review_check", keys.hourly("review_check", r.id, now));
      add("gm_alerts", keys.hourly("gm_alerts", r.id, now));
    }
    add("feedback", keys.hourly("feedback", r.id, now));
    add("release_sends", keys.hourly("release_sends", r.id, now));
  }
  // From 9am, once a day: the morning job's first step (the rest follow in order).
  if (morningGateResult === null) {
    const { day, step } = firstMorningStep(now);
    add("morning", keys.morning(r.id, day, step), { concurrencyKey: concurrencyKeys.morning(r.id), payload: { step, day, carry: {} } });
  }
  // The nightly models: each queued by the hourly run in the UK hour of its `at`
  // to start at that time (05:35 after the 05:00 trading-day cut-off; 07:00 for
  // the weather refresh), and by the daily backup in case that run was missed
  // (one key per model per UK day, so a model runs once a day). Last, so a
  // problem queueing them never stops the jobs above.
  if (models.length) {
    const day = londonYmd(now);
    const p = londonParts(now);
    for (const model of models) {
      if (job !== "daily" && p.hour !== model.at.hour) continue;
      const due = londonTime(p.year, p.month, p.day, model.at.hour, model.at.minute);
      const runAt = due > now ? due : undefined; // a late run (or the backup) starts it at once
      add(model.type, keys.model(model.type, r.id, day), { concurrencyKey: concurrencyKeys.models(r.id), payload: { day }, ...(runAt ? { runAt } : {}) });
    }
  }
  return out;
}
