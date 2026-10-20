// Which model outputs may ever reach an owner (pure, no imports; tests/analytics-jobs.test.ts).
//
// Every model run has a role (supabase/039_analytics_jobs.sql):
//   benchmark   a yardstick other models must beat (e.g. forecast_baseline). Never
//               shown to an owner, used in a message, or fed to an agent, whatever
//               its back-test says.
//   production  may be shown, but only once it succeeded and its back-test passed.
// Every read of a model output in the app goes through src/lib/ops/models.ts,
// which keeps only rows whose run passes isShowableRun.
export type ModelRole = "benchmark" | "production";

export function isShowableRun(run: { role?: string | null; status?: string | null; passed?: boolean | null } | null | undefined) {
  return run?.role === "production" && run.status === "succeeded" && run.passed === true;
}

// The output tables a model writes (the gate in ops/models.ts is the only reader).
// model_coefficients and forecast_drivers came with the demand forecast (040).
export const MODEL_OUTPUT_TABLES = ["forecasts", "suggested_rotas", "suggested_rota_shifts", "menu_analysis", "finance_snapshots", "deal_outcomes", "model_coefficients", "forecast_drivers"] as const;
