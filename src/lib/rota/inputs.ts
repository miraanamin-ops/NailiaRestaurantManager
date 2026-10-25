import "server-only";
import { dummyDataAllowed } from "@/lib/dummy-data";
import { db, must } from "@/lib/ops/db";
import { activeOn, valueOn } from "@/lib/ops/history";
import { listStaff } from "@/lib/ops/staff";
import type { RotaRuleRow, StaffAvailabilityRow, StaffPayRateRow } from "@/lib/ops/types";
import { isMonday } from "@/lib/forecast/week-ahead-rules";
import { DUMMY_RULES, DUMMY_STAFF, hhmm, noAvailability, type RotaInputs, type Weekday } from "./types";

// Everything the rota is built from for one week (docs/pilot-sprint.md): staff
// employed that Monday, their pay and availability in force on it, and the
// rules per role. In test mode a demo restaurant with no staff gets dummy data.
export async function getRotaInputs(restaurantId: string, weekStart: string): Promise<RotaInputs> {
  if (!isMonday(weekStart)) throw new Error(`getRotaInputs: ${weekStart} isn't a Monday`);
  const [people, pay, availability, rules] = await Promise.all([
    listStaff(restaurantId),
    db().from("staff_pay_rates").select("*").eq("restaurant_id", restaurantId),
    db().from("staff_availability").select("*").eq("restaurant_id", restaurantId).in("kind", ["available", "preferred"]),
    db().from("rota_rules").select("*").eq("restaurant_id", restaurantId).order("role"),
  ]);
  const weekEnd = new Date(Date.parse(`${weekStart}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const employed = people.filter((p) => (!p.employment_start || p.employment_start <= weekEnd) && (!p.employment_end || p.employment_end >= weekStart));
  if (!employed.length && (await dummyDataAllowed(restaurantId))) {
    return { restaurantId, weekStart, source: "dummy", staff: DUMMY_STAFF, rules: DUMMY_RULES };
  }
  const payRows = (must(pay, "pay rates") ?? []) as StaffPayRateRow[];
  const spans = activeOn((must(availability, "availability") ?? []) as StaffAvailabilityRow[], weekStart);
  return {
    restaurantId,
    weekStart,
    source: "tables",
    staff: employed.map((p) => {
      const a = noAvailability();
      for (const s of spans) if (s.staff_id === p.id) a[s.weekday as Weekday].push({ starts: hhmm(s.starts), ends: hhmm(s.ends) });
      for (const list of Object.values(a)) list.sort((x, y) => x.starts.localeCompare(y.starts));
      return {
        id: p.id,
        name: p.display_name,
        roles: p.roles,
        hourly_rate_pence: valueOn(payRows.filter((r) => r.staff_id === p.id), weekStart)?.hourly_pence ?? null,
        max_hours_week: p.max_hours_week === null ? null : Number(p.max_hours_week),
        availability: a,
      };
    }),
    rules: ((must(rules, "rota rules") ?? []) as RotaRuleRow[]).map((r) => ({
      role: r.role,
      min_on_shift: r.min_on_shift,
      orders_per_extra_staff: r.orders_per_extra_staff === null ? null : Number(r.orders_per_extra_staff),
    })),
  };
}
