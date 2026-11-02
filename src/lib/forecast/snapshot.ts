import "server-only";
import { londonYmd } from "@/lib/clock";
import { getSupabase } from "@/lib/supabase";
import { getWeekAhead } from "./week-ahead";
import type { WeekAhead } from "./week-ahead-rules";

// Each restaurant's week forecast, worked out once a day and saved (migration 055,
// forecast_snapshots). The brief, the Monday report, the rota and Insights all read
// the same saved copy, so they can never show different numbers for the same day:
// a forecast run (05:35, or the 07:00 refresh) or a sales upload that lands between
// the report and the brief only shows from the next day. The report's "Last week"
// reads the copy saved on that week's Monday: what the owner was actually told.
//
// Before 055 has run on a database, the table isn't there: everything carries on
// as before 055 (worked out live each time), so nothing breaks in between.

const MISSING = new Set(["42P01", "PGRST205"]); // Postgres / PostgREST: no such table
const missing = (error: { code?: string } | null) => Boolean(error?.code && MISSING.has(error.code));

async function readSaved(restaurantId: string, weekStart: string, madeOn: string) {
  const { data, error } = await getSupabase()
    .from("forecast_snapshots")
    .select("data")
    .eq("restaurant_id", restaurantId)
    .eq("week_start", weekStart)
    .eq("made_on", madeOn)
    .maybeSingle<{ data: WeekAhead }>();
  if (missing(error)) return { table: false as const };
  if (error) throw new Error(`Couldn't read the saved forecast: ${error.message}`);
  return { table: true as const, saved: data?.data ?? null };
}

// The week's forecast as saved today, working it out (and saving it) the first time.
// If two ask at once, the first copy saved is the one both get.
export async function savedWeekAhead(restaurantId: string, weekStart: string, now = new Date()): Promise<WeekAhead> {
  const today = londonYmd(now);
  const first = await readSaved(restaurantId, weekStart, today);
  if (first.table && first.saved) return first.saved;
  const fresh = await getWeekAhead(restaurantId, weekStart, now);
  if (!first.table) return fresh;
  const { error } = await getSupabase()
    .from("forecast_snapshots")
    .upsert({ restaurant_id: restaurantId, week_start: weekStart, made_on: today, data: fresh }, { onConflict: "restaurant_id,week_start,made_on", ignoreDuplicates: true });
  if (missing(error)) return fresh;
  if (error) throw new Error(`Couldn't save the forecast: ${error.message}`);
  const again = await readSaved(restaurantId, weekStart, today);
  return (again.table && again.saved) || fresh;
}

// What the owner was told about a past week: the copy saved on its Monday (the
// brief that morning), else the earliest copy saved during that week. null: none
// saved (a week before 055, or no brief that week).
export async function toldForWeek(restaurantId: string, weekStart: string): Promise<WeekAhead | null> {
  const { data, error } = await getSupabase()
    .from("forecast_snapshots")
    .select("data, made_on")
    .eq("restaurant_id", restaurantId)
    .eq("week_start", weekStart)
    .gte("made_on", weekStart)
    .order("made_on", { ascending: true })
    .limit(1)
    .returns<{ data: WeekAhead; made_on: string }[]>();
  if (missing(error)) return null;
  if (error) throw new Error(`Couldn't read the saved forecast: ${error.message}`);
  return data?.[0]?.data ?? null;
}
