import "server-only";
import { check, checkRow } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import * as flow from "./flow";

// Onboarding with Dina, saved: one session per restaurant, one row per step,
// and the setup gaps. Every change goes through the pure rules in flow.ts, then
// is saved here, so the web chat and WhatsApp always see the same place.
// Safe to repeat: starting twice, or saving the same step twice, changes nothing more.

export type Channel = "web" | "whatsapp";

export type Session = {
  restaurant_id: string;
  account_id: string | null;
  flow_version: number;
  current_step: flow.FlowStepKey | null;
  channel_last_used: Channel | null;
  started_at: string;
  completed_at: string | null;
  abandoned_reminder_sent_at: string | null;
  stall_alerted_at: string | null;
  updated_at: string;
};

type StepRow = {
  restaurant_id: string;
  step_key: string;
  status: flow.FlowStatus;
  data: Record<string, unknown> | null;
  waiting_on: string | null;
  started_at: string | null;
  completed_at: string | null;
  skipped_at: string | null;
};

export async function getSession(restaurantId: string) {
  return check(await getSupabase().from("onboarding_sessions").select("*").eq("restaurant_id", restaurantId).maybeSingle<Session>());
}

// The one way into Dina's setup. Sign-up calls it today. TODO(stripe): once
// ONBOARDING_REQUIRES_PAYMENT is on, the Stripe webhook calls it instead (after
// the trial starts), and nothing else changes. Calling it again returns the
// session already there.
export async function startOnboarding(restaurantId: string, opts: { channel?: Channel } = {}): Promise<Session> {
  const existing = await getSession(restaurantId);
  if (existing) return existing;
  const { data, error } = await getSupabase()
    .from("onboarding_sessions")
    .insert({ restaurant_id: restaurantId, flow_version: 2, current_step: flow.currentStep({}), channel_last_used: opts.channel ?? null })
    .select("*")
    .single<Session>();
  // Two starts at once: the other one made it.
  if (error?.code === "23505") return (await getSession(restaurantId))!;
  if (error || !data) throw new Error(`Couldn't start onboarding: ${error?.message ?? "no row"}`);
  return data;
}

const toState = (rows: StepRow[]): flow.FlowState =>
  Object.fromEntries(
    rows
      .filter((r) => flow.isFlowStep(r.step_key))
      .map((r) => [
        r.step_key,
        { status: r.status, data: r.data ?? {}, waitingOn: r.waiting_on, startedAt: r.started_at, completedAt: r.completed_at, skippedAt: r.skipped_at },
      ]),
  );

export async function loadFlow(restaurantId: string) {
  const supabase = getSupabase();
  const [session, steps, gaps] = await Promise.all([
    getSession(restaurantId),
    supabase.from("onboarding_steps").select("*").eq("restaurant_id", restaurantId).returns<StepRow[]>(),
    supabase.from("setup_gaps").select("*").eq("restaurant_id", restaurantId).returns<flow.Gap[]>(),
  ]);
  if (!session) throw new Error("This restaurant hasn't started onboarding");
  return { session, state: toState(check(steps) ?? []), gaps: check(gaps) ?? [] };
}

// Saves one step's new state, where the owner is now, and the gaps that follow.
// Where the owner is: the step they went to (focus), or else the first step not
// dealt with yet, so going back to edit a finished step puts Dina on that step.
async function save(restaurantId: string, key: flow.FlowStepKey, state: flow.FlowState, gaps: flow.Gap[], channel?: Channel, focus?: flow.FlowStepKey) {
  const supabase = getSupabase();
  const s = flow.stepState(state, key);
  const now = new Date().toISOString();
  check(
    await supabase.from("onboarding_steps").upsert(
      {
        restaurant_id: restaurantId,
        step_key: key,
        status: s.status,
        data: s.data,
        waiting_on: s.waitingOn,
        started_at: s.startedAt,
        completed_at: s.completedAt,
        skipped_at: s.skippedAt,
        updated_at: now,
      },
      { onConflict: "restaurant_id,step_key" },
    ),
  );
  const session = checkRow(
    await supabase
      .from("onboarding_sessions")
      .update({ current_step: focus ?? flow.currentStep(state), updated_at: now, ...(channel ? { channel_last_used: channel } : {}) })
      .eq("restaurant_id", restaurantId)
      .select("*")
      .single<Session>(),
  );

  const change = flow.syncGaps(gaps, state);
  if (change.add.length) {
    // A gap already there (two saves at once) is left as it is.
    const { error } = await supabase.from("setup_gaps").insert(change.add.map((g) => ({ restaurant_id: restaurantId, ...g })));
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  if (change.resolve.length) check(await supabase.from("setup_gaps").update({ resolved_at: now }).eq("restaurant_id", restaurantId).in("id", change.resolve));
  if (change.reopen.length) {
    check(await supabase.from("setup_gaps").update({ resolved_at: null, nudge_count: 0, snoozed_until: null }).eq("restaurant_id", restaurantId).in("id", change.reopen));
  }
  return { session, state };
}

type Opts = { channel?: Channel; now?: Date };

async function change(restaurantId: string, key: flow.FlowStepKey, opts: Opts, fn: (state: flow.FlowState, now: string) => flow.FlowState, focus?: flow.FlowStepKey) {
  const { state, gaps } = await loadFlow(restaurantId);
  const next = fn(state, (opts.now ?? new Date()).toISOString());
  return save(restaurantId, key, next, gaps, opts.channel, focus);
}

// Going to a step makes it the one Dina is on, even a finished one being edited.
export const enterStep = (restaurantId: string, key: flow.FlowStepKey, opts: Opts = {}) => change(restaurantId, key, opts, (s, now) => flow.enter(s, key, now), key);

export const skipStep = (restaurantId: string, key: flow.FlowStepKey, opts: Opts = {}) => change(restaurantId, key, opts, (s, now) => flow.skip(s, key, now));

// Only for checked data: Dina's tools call this after their own validation.
export const completeStep = (restaurantId: string, key: flow.FlowStepKey, outcome: "done" | "partial", data: Record<string, unknown>, opts: Opts = {}) =>
  change(restaurantId, key, opts, (s, now) => flow.complete(s, key, outcome, data, now));

// A draft of what the owner said, kept on the step (never a status change beyond "in progress").
export const noteStep = (restaurantId: string, key: flow.FlowStepKey, data: Record<string, unknown>, opts: Opts = {}) =>
  change(restaurantId, key, opts, (s, now) => flow.note(s, key, data, now), key);

export const waitOnStep = (restaurantId: string, key: flow.FlowStepKey, waitingOn: string, data: Record<string, unknown>, opts: Opts = {}) =>
  change(restaurantId, key, opts, (s, now) => flow.wait(s, key, waitingOn, data, now));
