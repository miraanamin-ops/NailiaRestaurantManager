import "server-only";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// The builder's forecast error limit for one restaurant (null = the default in
// lib/forecast/baseline.ts). Logged, so /log shows who changed it and when.
export async function setForecastErrorLimit(restaurantId: string, limit: number | null) {
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0 || limit > 100)) return false;
  const value = limit === null ? null : Math.round(limit * 10) / 10;
  const before = check(await getSupabase().from("restaurants").select("forecast_error_limit_pct").eq("id", restaurantId).maybeSingle<{ forecast_error_limit_pct: number | null }>());
  check(await getSupabase().from("restaurants").update({ forecast_error_limit_pct: value }).eq("id", restaurantId));
  await logAction({
    restaurantId,
    actor: "builder",
    action: "builder_command",
    detail: value === null ? "Forecast error limit back to the default" : `Forecast error limit set to ${value}%`,
    data: { field: "forecast_error_limit_pct", before: before?.forecast_error_limit_pct ?? null, after: value },
  });
  return true;
}
