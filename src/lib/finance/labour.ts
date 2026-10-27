import "server-only";
import { check } from "@/lib/drafts";
import { weekDays } from "@/lib/forecast/week-ahead-rules";
import { valueOn } from "@/lib/ops/history";
import { paidMinutes } from "@/lib/ops/staff";
import type { StaffPayRateRow } from "@/lib/ops/types";
import type { StoredPlan } from "@/lib/rota/build";
import { getSupabase } from "@/lib/supabase";
import type { LabourWeek } from "./rules";

type WeekRow = { id: string; status: "draft" | "approved" | "published"; summary: StoredPlan | null; updated_at: string };
type ShiftRow = { staff_id: string | null; role: string; business_date: string; starts_at: string; ends_at: string; break_minutes: number };

// A week's labour cost from its rota (docs/pilot-sprint.md, "Finance forecast"):
// the approved (or published) rota if there is one, else the draft. A rota the
// suggester made carries its own costs (its summary: hours x rate to the penny,
// open shifts at the role's average rate); any other (an imported or older
// rota) is costed here from its shifts at each person's rate that day.
export async function labourForWeek(restaurantId: string, weekStart: string): Promise<LabourWeek> {
  const weeks =
    check(
      await getSupabase()
        .from("rota_weeks")
        .select("id, status, summary, updated_at")
        .eq("restaurant_id", restaurantId)
        .eq("week_start", weekStart)
        .returns<WeekRow[]>(),
    ) ?? [];
  const rank = (w: WeekRow) => (w.status === "draft" ? 0 : 1);
  const week = [...weeks].sort((a, b) => rank(b) - rank(a) || b.updated_at.localeCompare(a.updated_at))[0];
  if (!week) return { status: "none", costPence: 0, hours: 0, byDay: {}, missingRates: 0 };

  if (week.summary?.days?.length) {
    const byDay = Object.fromEntries(week.summary.days.map((d) => [d.date, d.costPence]));
    return { status: week.status, costPence: week.summary.totals.costPence, hours: week.summary.totals.hours, byDay, missingRates: 0 };
  }

  const [shifts, rates] = await Promise.all([
    getSupabase()
      .from("rota_shifts")
      .select("staff_id, role, business_date, starts_at, ends_at, break_minutes")
      .eq("restaurant_id", restaurantId)
      .eq("rota_week_id", week.id)
      .returns<ShiftRow[]>(),
    getSupabase().from("staff_pay_rates").select("*").eq("restaurant_id", restaurantId).returns<StaffPayRateRow[]>(),
  ]);
  const rateRows = check(rates) ?? [];
  const byDay: Record<string, number> = Object.fromEntries(weekDays(weekStart).map((d) => [d, 0]));
  let minutes = 0;
  let missing = 0;
  for (const s of check(shifts) ?? []) {
    const m = paidMinutes({ ...s, break_minutes: s.break_minutes ?? 0 });
    minutes += m;
    const rate = s.staff_id ? valueOn(rateRows.filter((r) => r.staff_id === s.staff_id), s.business_date)?.hourly_pence : null;
    if (rate == null) {
      missing++;
      continue;
    }
    byDay[s.business_date] = (byDay[s.business_date] ?? 0) + Math.round((m / 60) * Number(rate));
  }
  return {
    status: week.status,
    costPence: Object.values(byDay).reduce((n, c) => n + c, 0),
    hours: Math.round(minutes / 6) / 10,
    byDay,
    missingRates: missing,
  };
}

// The owner's labour target (% of sales), or null if they haven't set one.
export async function labourTarget(restaurantId: string) {
  const r = check(await getSupabase().from("restaurants").select("labour_target_pct").eq("id", restaurantId).maybeSingle<{ labour_target_pct: number | string | null }>());
  return r?.labour_target_pct == null ? null : Number(r.labour_target_pct);
}
