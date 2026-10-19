import "server-only";
import { alertBuilder } from "@/lib/builder-alerts";
import { getSupabase } from "@/lib/supabase";
import { FEEDS, feedProblem, missingKey, nextRunAt, type FeedName } from "./config";

// Each feed's switch and health (feed_status, supabase/041_outside_feeds.sql).
// Problems go to the builder only; an owner is never told about a feed.

export type FeedStatus = {
  feed: FeedName;
  enabled: boolean;
  fresh_hours: number | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_outcome: "ok" | "skipped" | "failed" | null;
  last_error: string | null;
  last_rows: Record<string, number> | null;
  last_detail: Record<string, unknown> | null;
  next_run_at: string | null;
  alerted_at: string | null;
};

export async function feedStatuses(): Promise<FeedStatus[]> {
  const { data, error } = await getSupabase().from("feed_status").select("*").order("feed").returns<FeedStatus[]>();
  if (error) throw new Error(`feed status: ${error.message}`);
  return data ?? [];
}

export async function enabledFeeds(): Promise<Record<string, boolean>> {
  try {
    return Object.fromEntries((await feedStatuses()).map((s) => [s.feed, s.enabled]));
  } catch (err) {
    // Before 041 is run: every feed is off (nothing to write into yet).
    console.error("Couldn't read the feed switches", err);
    return Object.fromEntries(Object.keys(FEEDS).map((f) => [f, false]));
  }
}

export type FeedOutcome = { skipped: string } | { rows: Record<string, number>; detail?: Record<string, unknown> };

// Runs one feed's work and records what happened. A missing API key or a feed
// switched off is "skipped" (reported, never a crash); a failure is recorded
// and thrown again, so the queue retries it (and alerts the builder if it dies).
export async function runFeed(feed: FeedName, work: () => Promise<FeedOutcome>, env: Record<string, string | undefined> = process.env): Promise<FeedOutcome> {
  const supabase = getSupabase();
  const now = new Date();
  const { data: status } = await supabase.from("feed_status").select("enabled, last_rows").eq("feed", feed).maybeSingle<{ enabled: boolean; last_rows: Record<string, number> | null }>();
  const record = async (patch: Record<string, unknown>) => {
    const { error } = await supabase
      .from("feed_status")
      .update({ last_run_at: now.toISOString(), next_run_at: nextRunAt(feed, now)?.toISOString() ?? null, updated_at: new Date().toISOString(), ...patch })
      .eq("feed", feed);
    if (error) console.error(`Couldn't record the ${feed} feed's run`, error.message);
  };
  if (status && !status.enabled) {
    await record({ last_outcome: "skipped", last_detail: { skipped: "switched off on /feeds" } });
    return { skipped: "switched off on /feeds" };
  }
  const noKey = missingKey(feed, env);
  if (noKey) {
    await record({ last_outcome: "skipped", last_error: null, last_detail: { skipped: noKey } });
    return { skipped: noKey };
  }
  try {
    const out = await work();
    if ("skipped" in out) await record({ last_outcome: "skipped", last_detail: { skipped: out.skipped } });
    else await record({ last_outcome: "ok", last_success_at: new Date().toISOString(), last_error: null, last_rows: out.rows, last_detail: out.detail ?? null, alerted_at: null });
    return out;
  } catch (err) {
    await record({ last_outcome: "failed", last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    throw err;
  }
}

// Adds to the rows a feed reported in this run (feeds that run as several jobs, e.g. one per restaurant).
export function addRows(into: Record<string, number>, more: Record<string, number>) {
  for (const [k, v] of Object.entries(more)) into[k] = (into[k] ?? 0) + v;
  return into;
}

// The watchdog (every hourly health check): a feed stale or failing tells the builder.
export async function checkFeedHealth(now: Date) {
  let statuses: FeedStatus[];
  try {
    statuses = await feedStatuses();
  } catch {
    return [];
  }
  const problems: string[] = [];
  for (const s of statuses) {
    const problem = feedProblem(s, now);
    if (!problem) continue;
    problems.push(problem);
    await alertBuilder(`feed:${s.feed}`, `Outside data: ${problem}. See "Outside data" on /log. The forecast still runs, with what it already has. No owner has been told.`);
  }
  return problems;
}
