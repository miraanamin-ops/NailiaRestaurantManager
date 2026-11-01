import "server-only";
import { after } from "next/server";
import { loadRestaurantContext } from "@/lib/assistant";
import { logAction } from "@/lib/audit";
import { londonLongDate, londonParts, londonTime, londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { mondayOf, weekdayOf } from "@/lib/forecast/week-ahead-rules";
import { savedWeekAhead } from "@/lib/forecast/snapshot";
import { runReviewCheck, type Send } from "@/lib/google-jobs";
import { briefHourOf } from "@/lib/morning-gate";
import { runMorningStep, type MorningCarry } from "@/lib/morning";
import type { MorningStep } from "@/lib/queue/rules";
import { messageOwner } from "@/lib/notify";
import { kickWorkers } from "@/lib/queue/kick";
import { concurrencyKeys, morningStepsFor } from "@/lib/queue/rules";
import { enqueue } from "@/lib/queue/store";
import { SIMULATED_REVIEW_SOURCE } from "@/lib/gate-rules";
import { REST_HOUR, runDaySteps, simulatedDay, simulatedReview, simulatedZ, simulationOn, usualTakings } from "@/lib/simulation-rules";
import { getSupabase, restaurantNow, type Restaurant } from "@/lib/supabase";

// The Pilot Zero simulation (docs/pilot-zero.md, phase 3; rules in
// lib/simulation-rules.ts). Builder only: the admin console page
// (/onboarding/admin/pilot-zero) and its actions check the login. Only a
// restaurant marked for Pilot Zero can be simulated, so a real pilot's never is.
// Every action is in the audit log (action "simulation", actor builder).

export class SimulationError extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function at(day: string, hour: number, minute = 0) {
  const [y, m, d] = day.split("-").map(Number);
  return londonTime(y, m, d, hour, minute);
}

async function load(restaurantId: string) {
  const r = check(await getSupabase().from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Restaurant>());
  if (!r) throw new SimulationError("That restaurant wasn't found");
  if (!("pilot_zero" in r)) throw new SimulationError("Run supabase/056_pilot_zero.sql on this database first.");
  if (!r.pilot_zero) throw new SimulationError(`${r.name} isn't marked for Pilot Zero, so it can't be simulated`);
  return r;
}

async function loadSimulating(restaurantId: string) {
  const r = await load(restaurantId);
  const day = simulatedDay(r, londonYmd);
  if (!day) throw new SimulationError(`Start the simulation for ${r.name} first (pick a date).`);
  return { r, day };
}

async function setClock(r: Restaurant, when: Date | null) {
  check(await getSupabase().from("restaurants").update({ fake_now: when ? when.toISOString() : null }).eq("id", r.id).eq("pilot_zero", true));
}

const log = (r: Restaurant, builderEmail: string, detail: string, data: Record<string, unknown> = {}) =>
  logAction({ restaurantId: r.id, actor: "builder", action: "simulation", detail: `${detail} (by ${builderEmail})`, data });

// Starts the simulation on a date, or moves it to another (Next day). The clock
// rests at midday on that date. Real scheduled jobs skip the restaurant from now on.
export async function setSimulatedDay(restaurantId: string, day: string, builderEmail: string) {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) throw new SimulationError("Pick a date (YYYY-MM-DD).");
  const r = await load(restaurantId);
  const before = simulatedDay(r, londonYmd);
  await setClock(r, at(day, REST_HOUR));
  await log(r, builderEmail, before ? `Simulated date moved from ${before} to ${day}` : `Simulation started on ${day}: real scheduled jobs skip this restaurant`, { before, after: day });
  return day;
}

export async function nextSimulatedDay(restaurantId: string, builderEmail: string) {
  const { day } = await loadSimulating(restaurantId);
  const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return setSimulatedDay(restaurantId, next, builderEmail);
}

// Back to real time. Simulated reviews still waiting are marked handled, so the
// real review check never drafts replies to them (they stay until cleared).
export async function stopSimulation(restaurantId: string, builderEmail: string) {
  const r = await load(restaurantId);
  const day = simulatedDay(r, londonYmd);
  check(
    await getSupabase()
      .from("reviews")
      .update({ handled_at: new Date().toISOString() })
      .eq("restaurant_id", r.id)
      .eq("simulated", true)
      .is("handled_at", null),
  );
  await setClock(r, null);
  await log(r, builderEmail, `Simulation stopped${day ? ` (it was on ${day})` : ""}: back to real time and the real scheduled jobs`);
}

// A till report for the simulated date: the usual takings for that weekday (or
// the amount given), or a quiet day at about 45% of usual. Stored as dummy and
// simulated sales. Never replaces real figures for that day.
export async function injectZReport(restaurantId: string, opts: { quiet: boolean; net?: number | null }, builderEmail: string) {
  const { r, day } = await loadSimulating(restaurantId);
  const supabase = getSupabase();
  const existing = check(await supabase.from("sales_days").select("id, simulated").eq("restaurant_id", r.id).eq("day", day).maybeSingle<{ id: string; simulated: boolean | null }>());
  if (existing && !existing.simulated) throw new SimulationError(`${day} already has real sales figures, so no simulated till report was added.`);
  const since = new Date(Date.parse(`${day}T12:00:00Z`) - 56 * 86_400_000).toISOString().slice(0, 10);
  const history =
    check(
      await supabase
        .from("sales_days")
        .select("day, net_sales")
        .eq("restaurant_id", r.id)
        .eq("simulated", false)
        .gte("day", since)
        .lt("day", day)
        .returns<{ day: string; net_sales: number }[]>(),
    ) ?? [];
  const base = opts.net && opts.net > 0 ? opts.net : usualTakings(history, weekdayOf(day), weekdayOf);
  const z = simulatedZ({ net: base, quiet: opts.quiet });
  check(
    await supabase.from("sales_days").upsert(
      {
        restaurant_id: r.id,
        day,
        net_sales: z.net_sales,
        gross_sales: z.gross_sales,
        vat: z.vat,
        transactions: z.transactions,
        card: z.card,
        cash: z.cash,
        discounts: 0,
        refunds: 0,
        net_estimated: false,
        source: "z_report",
        z_report_id: null,
        is_dummy: true,
        simulated: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "restaurant_id,day" },
    ),
  );
  check(await supabase.from("sales_hours").delete().eq("restaurant_id", r.id).eq("day", day).eq("simulated", true));
  check(
    await supabase
      .from("sales_hours")
      .insert(z.hourly.map((h) => ({ restaurant_id: r.id, day, hour: h.hour, sales: h.sales, source: "z_report", is_dummy: true, simulated: true }))),
  );
  await log(r, builderEmail, `Simulated ${opts.quiet ? "quiet day" : "till report"} for ${day}: £${z.net_sales.toFixed(2)} net, ${z.transactions} transactions`, { day, ...z, quiet: opts.quiet });
  return { day, net: z.net_sales, quiet: opts.quiet };
}

// A simulated Google review, arriving at the simulated time. It's never replied
// to on Google (lib/gate-rules.ts), and its author's name starts "Sim:".
export async function injectReview(restaurantId: string, rating: number, builderEmail: string) {
  const { r } = await loadSimulating(restaurantId);
  const supabase = getSupabase();
  const { count } = await supabase.from("reviews").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("simulated", true).eq("rating", rating);
  const review = simulatedReview(rating, count ?? 0);
  const when = restaurantNow(r);
  check(
    await supabase.from("reviews").insert({
      restaurant_id: r.id,
      source: SIMULATED_REVIEW_SOURCE,
      simulated: true,
      author_name: review.author,
      rating: review.rating,
      text: review.text,
      review_date: when.toISOString(),
      replied: false,
    }),
  );
  await log(r, builderEmail, `Simulated ${review.rating}-star review from ${review.author}`, { rating: review.rating });
  return review;
}

// Run day, queued (it can take a few minutes: the brief, review replies and the
// rota are written by Claude). Each step is its own job, run in order; the page
// shows how far it has got.
export async function queueRunDay(restaurantId: string, builderEmail: string) {
  const { r, day } = await loadSimulating(restaurantId);
  await enqueueDayStep(r.id, { day, run: String(Date.now()), index: 0, carry: {}, results: [] });
  await log(r, builderEmail, `Run day queued for ${day}`, { day });
  after(() => kickWorkers(1));
  return day;
}

export type DayResult = { label: string; at: string; done?: string; error?: string };
export type DayPayload = { day: string; run: string; index: number; carry: MorningCarry; results: DayResult[] };

const enqueueDayStep = (restaurantId: string, p: DayPayload) =>
  enqueue({
    type: "sim_day",
    restaurantId,
    key: `sim_day:${restaurantId}:${p.run}:${p.index}`,
    priority: 5,
    concurrencyKey: concurrencyKeys.morning(restaurantId),
    payload: p,
    maxAttempts: 1,
  });

// One step of Run day (lib/simulation-rules.ts runDaySteps) at its simulated time,
// then the next step is queued. A step that fails is recorded and the rest still
// run (the real jobs are independent; the morning steps carry on as their retry
// would). After the last step the clock rests at midday and it's logged.
export async function runDayStep(restaurantId: string, p: DayPayload) {
  const supabase = getSupabase();
  const reload = async () => check(await supabase.from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Restaurant>());
  const first = await reload();
  if (!first || simulatedDay(first, londonYmd) !== p.day) return { skipped: `the simulation isn't on ${p.day} any more`, results: p.results };
  const weekday = weekdayOf(p.day);
  const steps = runDaySteps(weekday, briefHourOf(first), morningStepsFor(weekday));
  const step = steps[p.index];
  const results = [...p.results];
  let carry = p.carry;
  if (step) {
    const now = at(p.day, step.hour, step.minute);
    const result: DayResult = { label: step.label, at: `${String(step.hour).padStart(2, "0")}:${String(step.minute).padStart(2, "0")}` };
    results.push(result);
    try {
      await setClock(first, now);
      const r = (await reload())!;
      const channel = ownerChannel(r);
      const send: Send = (text, withButtons = false, mediaUrl = null) => (channel ? messageOwner(channel, text, withButtons, { mediaUrl }) : Promise.resolve());
      if (step.step === "reviews") {
        if (!channel) result.done = "skipped: no owner WhatsApp yet";
        else {
          const out = await runReviewCheck(await loadRestaurantContext(r.id), (text, withButtons) => messageOwner(channel, text, withButtons));
          result.done = JSON.stringify(out);
        }
      } else if (step.step === "forecast") {
        const week = await savedWeekAhead(r.id, mondayOf(p.day), now);
        result.done = `the week of ${week.weekStart} saved`;
      } else if (step.step === "morning") {
        const out = await runMorningStep(r, step.morning as MorningStep, now, carry);
        carry = out.carry;
        result.done = typeof out.brief === "string" ? `${out.done} (${out.brief})` : out.done;
      } else if (step.step === "rota") {
        if (!channel) result.done = "skipped: no owner WhatsApp yet";
        else {
          const { suggestRota } = await import("@/lib/rota/build");
          result.done = JSON.stringify(await suggestRota(r, { now, send, mode: "urgent", actor: "scheduled job", rebuild: false }));
        }
      }
    } catch (err) {
      result.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    }
  }
  if (p.index + 1 < steps.length) {
    await enqueueDayStep(restaurantId, { ...p, index: p.index + 1, carry, results });
    after(() => kickWorkers(1));
    return { day: p.day, step: step?.label, of: `${p.index + 1} of ${steps.length}`, results };
  }
  await setClock(first, at(p.day, REST_HOUR));
  const failed = results.filter((x) => x.error).length;
  await logAction({
    restaurantId,
    actor: "builder",
    action: "simulation",
    detail: `Run day for ${p.day} (${londonLongDate(at(p.day, REST_HOUR))}): ${results.map((x) => `${x.label} ${x.error ? "failed" : "done"}`).join(", ")}`,
    data: { day: p.day, results },
  });
  return { day: p.day, finished: true, failed, results };
}

// Removes everything the simulation injected for this restaurant: simulated
// reviews (drafts about them stay, without the review), till reports and hours.
export async function clearSimulatedData(restaurantId: string, builderEmail: string) {
  const r = await load(restaurantId);
  const supabase = getSupabase();
  const counts: Record<string, number> = {};
  for (const table of ["reviews", "sales_hours", "sales_days"]) {
    const res = await supabase.from(table).delete().eq("restaurant_id", r.id).eq("simulated", true).select("id");
    counts[table] = check(res)?.length ?? 0;
  }
  await log(r, builderEmail, `Simulated data cleared: ${counts.reviews} reviews, ${counts.sales_days} till reports`, counts);
  return counts;
}

export type SimulationView = {
  day: string | null;
  label: string | null;
  reviews: number;
  tillReports: number;
  lastRun: { status: string; created_at: string; result: Record<string, unknown> | null; last_error: string | null } | null;
};

export async function simulationView(r: Restaurant): Promise<SimulationView> {
  const supabase = getSupabase();
  const day = simulatedDay(r, londonYmd);
  const [reviews, days, run] = await Promise.all([
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("simulated", true),
    supabase.from("sales_days").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("simulated", true),
    supabase
      .from("jobs")
      .select("status, created_at, result, last_error")
      .eq("restaurant_id", r.id)
      .eq("type", "sim_day")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string; created_at: string; result: Record<string, unknown> | null; last_error: string | null }>(),
  ]);
  const clock = r.fake_now ? londonParts(new Date(r.fake_now)) : null;
  return {
    day,
    label: day && clock ? `${londonLongDate(new Date(r.fake_now!))}, ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}` : null,
    reviews: reviews.count ?? 0,
    tillReports: days.count ?? 0,
    lastRun: run.error ? null : (run.data ?? null),
  };
}

export { simulationOn };
