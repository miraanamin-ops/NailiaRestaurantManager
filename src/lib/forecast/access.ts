// The builder's demo-only override: show forecasts from runs that didn't pass,
// labelled "TEST: unvalidated forecast". All three must hold: TEST_TOOLS is on,
// the restaurant is a demo one, and its forecast_unvalidated setting is on
// (supabase/042 also refuses that setting on a real restaurant). Pure, unit-tested
// (tests/forecast.test.ts); lib/ops/models.ts asks it before returning any row
// from a run that didn't pass. Benchmark runs are never shown, override or not.
import { testToolsFor } from "@/lib/switches";

type Env = Record<string, string | undefined>;

export function unvalidatedForecastsAllowed(env: Env, restaurant: { is_demo?: boolean | null; forecast_unvalidated?: boolean | null } | null | undefined) {
  if (!restaurant) return false;
  return restaurant.is_demo === true && restaurant.forecast_unvalidated === true && testToolsFor(env, restaurant);
}

// May this run's outputs be shown to this restaurant, and is it labelled TEST?
export function runAccess(
  run: { role?: string | null; status?: string | null; passed?: boolean | null } | null | undefined,
  unvalidatedAllowed: boolean,
): { ok: boolean; unvalidated: boolean } {
  if (!run || run.role !== "production" || run.status !== "succeeded") return { ok: false, unvalidated: false };
  if (run.passed === true) return { ok: true, unvalidated: false };
  return unvalidatedAllowed ? { ok: true, unvalidated: true } : { ok: false, unvalidated: false };
}
