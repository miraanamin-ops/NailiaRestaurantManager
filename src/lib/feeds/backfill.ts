import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { PermanentJobError, type JobHandler } from "@/lib/queue/registry";
import { enqueue, type QueueJob } from "@/lib/queue/store";
import { getSupabase } from "@/lib/supabase";
import { addDays } from "./calendar-dates";
import { archiveForCell, previousRunsForCell, prayerFor, RESTAURANT_COLUMNS, saveActuals, type FeedRestaurantRow } from "./jobs";
import { ensureLocated } from "./location";
import { runFeed, type FeedOutcome } from "./status";
import { insertForecasts } from "./store";
import { PROVIDER } from "./weather-data";

// Backfill: the outside data for the history a restaurant's forecast trains on,
// not just the future. Queued when a restaurant is created (onboarding
// finishes), its address changes, a POS import brings older sales, or (for
// restaurants from before the feeds) by the hourly run once.
//
// A chain of parts, each its own job, so none runs past a worker's time limit:
//   locate     where it is (weather cell, council) and how far back to go
//   weather    archived actuals, a year at a time
//   forecasts  archived forecasts as issued (Open-Meteo Previous Runs), 92 days
//              at a time; they only go back to early 2024, and where they really
//              start is recorded on /log
//   prayer     calculated prayer times for the whole period
//   calendar   the shared calendar (bank holidays, religious and cultural
//              dates, paydays, clock changes, school holidays) and past Premier
//              League fixtures from the period's first year
//
// Ticketmaster and TfL have no history: past local events and disruption stay
// as the builder enters them.

export type BackfillReason = "created" | "location" | "pos_import" | "first_run" | "builder";
export type BackfillPart = "locate" | "weather" | "forecasts" | "prayer" | "calendar";

// Archived forecasts (ECMWF IFS 0.25) start here; earlier days have none.
export const PREVIOUS_RUNS_FROM = "2024-01-01";
// The least history to fill: a year, even for a restaurant with no sales yet.
const MIN_DAYS = 365;

export const backfillKey = (restaurantId: string, reason: string, day: string, part: BackfillPart, chunk = "") =>
  `feed_backfill:${restaurantId}:${reason}:${day}:${part}${chunk ? `:${chunk}` : ""}`;

// Queues a restaurant's backfill (once a day per reason).
export async function enqueueBackfill(restaurantId: string, reason: BackfillReason, now = new Date()) {
  const day = londonYmd(now);
  return enqueue({ type: "feed_backfill", restaurantId, key: backfillKey(restaurantId, reason, day, "locate"), payload: { reason, day, part: "locate" } });
}

// The day the backfill starts: the first sales day (or a year ago, if earlier), less a week.
export function backfillStart(firstSalesDay: string | null, today: string) {
  const yearAgo = addDays(today, -MIN_DAYS);
  return addDays(firstSalesDay && firstSalesDay < yearAgo ? firstSalesDay : yearAgo, -7);
}

type Payload = { reason: string; day: string; part: BackfillPart; from?: string; chunk?: string };

async function next(job: QueueJob, part: BackfillPart, extra: Partial<Payload>) {
  const p = job.payload as Payload;
  await enqueue({
    type: "feed_backfill",
    restaurantId: job.restaurant_id,
    key: backfillKey(job.restaurant_id!, p.reason, p.day, part, extra.chunk),
    payload: { ...p, part, ...extra },
  });
  return part;
}

async function load(id: string) {
  return check(await getSupabase().from("restaurants").select(RESTAURANT_COLUMNS).eq("id", id).maybeSingle<FeedRestaurantRow>());
}

export const backfillJob: JobHandler = {
  run: async (job) => {
    if (!job.restaurant_id) throw new PermanentJobError("A backfill needs a restaurant");
    const p = job.payload as Payload;
    const r = await load(job.restaurant_id);
    if (!r) return { skipped: "restaurant not found" };
    const supabase = getSupabase();
    const today = londonYmd(new Date());
    const yesterday = addDays(today, -1);

    const out = await runFeed("backfill", async (): Promise<FeedOutcome> => {
      switch (p.part) {
        case "locate": {
          const where = await ensureLocated(r);
          if (!where) return { skipped: `${r.name} has no address to find its weather for` };
          const first = check(
            await supabase.from("sales_days").select("day").eq("restaurant_id", r.id).order("day").limit(1).maybeSingle<{ day: string }>(),
          );
          const from = backfillStart(first?.day ?? null, today);
          return { rows: {}, detail: { cell: where.cell, from, next: await next(job, "weather", { from, chunk: from }) } };
        }
        case "weather": {
          const fresh = await load(r.id);
          if (!fresh?.weather_cell) throw new Error("The restaurant has no weather cell yet");
          const a = p.chunk!;
          const b = addDays(a, 364) < yesterday ? addDays(a, 364) : yesterday;
          const hours = await archiveForCell(fresh.weather_cell, a, b);
          const rows = await saveActuals([r.id], hours, PROVIDER.archive, new Date().toISOString(), "archive");
          const more = b < yesterday;
          const start = p.from! > PREVIOUS_RUNS_FROM ? p.from! : PREVIOUS_RUNS_FROM;
          const following = more ? await next(job, "weather", { chunk: addDays(b, 1) }) : await next(job, "forecasts", { chunk: start });
          return { rows, detail: { from: a, to: b, next: following } };
        }
        case "forecasts": {
          const fresh = await load(r.id);
          if (!fresh?.weather_cell) throw new Error("The restaurant has no weather cell yet");
          const a = p.chunk!;
          const b = addDays(a, 91) < yesterday ? addDays(a, 91) : yesterday;
          const runs = await previousRunsForCell(fresh.weather_cell, a, b);
          const added = await insertForecasts([...runs.days, ...runs.hours].map((f) => ({ restaurant_id: r.id, ...f, source: "feed" })));
          // Where the archived forecasts really start (they go back to early 2024 only), kept for /log.
          if (runs.firstDay) await noteForecastArchiveStart(runs.firstDay);
          const following = b < yesterday ? await next(job, "forecasts", { chunk: addDays(b, 1) }) : await next(job, "prayer", {});
          return { rows: { weather_forecasts: added }, detail: { from: a, to: b, first_day_with_forecasts: runs.firstDay, next: following } };
        }
        case "prayer": {
          const n = await prayerFor(r, p.from!, addDays(today, 60));
          return { rows: { prayer_times: n ?? 0 }, detail: { next: await next(job, "calendar", {}) } };
        }
        case "calendar": {
          const fromYear = Number(p.from!.slice(0, 4));
          // Shared by every restaurant: one job per first year (the same key from two restaurants is one job).
          await enqueue({ type: "feed_calendar", restaurantId: null, key: `feed_calendar:backfill:${fromYear}`, payload: { fromYear } });
          await enqueue({ type: "feed_football", restaurantId: null, key: `feed_football:backfill:${p.from}`, payload: { historyFrom: p.from } });
          check(await supabase.from("restaurants").update({ outside_backfilled_at: new Date().toISOString(), weather_backfilled_at: new Date().toISOString() }).eq("id", r.id));
          return { rows: {}, detail: { calendar_from: fromYear, done: true } };
        }
        default:
          throw new PermanentJobError(`Unknown backfill part ${String(p.part)}`);
      }
    });
    return { part: p.part, ...(out as Record<string, unknown>) };
  },
};

// The first day archived forecasts exist for, across every backfill (shown on /log).
export const FORECAST_ARCHIVE_KEY = "feeds:forecast_archive_from";
async function noteForecastArchiveStart(firstDay: string) {
  const supabase = getSupabase();
  const { data } = await supabase.from("cached_data").select("data").eq("key", FORECAST_ARCHIVE_KEY).maybeSingle<{ data: { day?: string } }>();
  if (data?.data?.day && data.data.day <= firstDay) return;
  const { error } = await supabase.from("cached_data").upsert({ key: FORECAST_ARCHIVE_KEY, data: { day: firstDay }, fetched_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) console.error("Couldn't note where archived forecasts start", error.message);
}
