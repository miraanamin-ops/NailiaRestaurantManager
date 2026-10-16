import "server-only";
import { activeOn, valueOn } from "./history";
import { db, must } from "./db";
import type {
  AgeBand,
  CoverRuleRow,
  OpsSource,
  RotaShiftRow,
  RotaStatus,
  RotaWeekRow,
  ShiftActualRow,
  StaffAvailabilityRow,
  StaffPayRateRow,
  StaffRow,
  StaffTimeOffRow,
} from "./types";

// Staff and rotas (032_ops_sales_staff_rota.sql). Staff data is employee personal
// data: only what a rota needs (no NI numbers, addresses, bank details or dates
// of birth). forgetStaffMember removes a person's details but keeps their hours
// and pay, which the owner must keep as wage records.

export async function addStaff(
  restaurantId: string,
  input: {
    displayName: string;
    roles?: string[];
    skills?: string[];
    contractedHours?: number | null;
    employmentStart?: string | null;
    ageBand?: AgeBand | null;
    ageBandSetOn?: string | null;
    staffNumberId?: string | null;
    source: OpsSource;
  },
) {
  return must(
    await db()
      .from("staff")
      .insert({
        restaurant_id: restaurantId,
        display_name: input.displayName.trim(),
        roles: input.roles ?? [],
        skills: input.skills ?? [],
        contracted_hours: input.contractedHours ?? null,
        employment_start: input.employmentStart ?? null,
        age_band: input.ageBand ?? null,
        age_band_set_on: input.ageBandSetOn ?? null,
        staff_number_id: input.staffNumberId ?? null,
        source: input.source,
      })
      .select("*")
      .single(),
    "add staff",
  ) as StaffRow;
}

export async function listStaff(restaurantId: string, opts: { includeFormer?: boolean } = {}) {
  let q = db().from("staff").select("*").eq("restaurant_id", restaurantId).order("display_name");
  if (!opts.includeFormer) q = q.is("deleted_at", null);
  return must(await q, "staff") as StaffRow[];
}

export async function endEmployment(restaurantId: string, staffId: string, lastDay: string) {
  must(
    await db().from("staff").update({ employment_end: lastDay, updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId).eq("id", staffId),
    "end employment",
  );
}

// Removes a person's name and details now (their hours and pay stay, unnamed).
export async function forgetStaffMember(restaurantId: string, staffId: string) {
  return must(await db().rpc("forget_staff_member", { p_restaurant_id: restaurantId, p_staff_id: staffId }), "forget staff member") as boolean;
}

// A new pay rate from a day (never changes an old one).
export async function setPayRate(restaurantId: string, staffId: string, hourlyPence: number, effectiveFrom: string, source: OpsSource) {
  if (!Number.isInteger(hourlyPence) || hourlyPence <= 0) throw new Error("Pay must be a whole number of pence");
  return must(
    await db()
      .from("staff_pay_rates")
      .insert({ restaurant_id: restaurantId, staff_id: staffId, hourly_pence: hourlyPence, effective_from: effectiveFrom, source })
      .select("*")
      .single(),
    "set pay rate",
  ) as StaffPayRateRow;
}

// Hourly pay in pence on a day, as known at a moment.
export async function payRateOn(restaurantId: string, staffId: string, day: string, knownAt?: string | Date) {
  const rows = must(await db().from("staff_pay_rates").select("*").eq("restaurant_id", restaurantId).eq("staff_id", staffId), "pay rates") as StaffPayRateRow[];
  return valueOn(rows, day, { knownAt })?.hourly_pence ?? null;
}

export async function availabilityOn(restaurantId: string, day: string) {
  const rows = must(await db().from("staff_availability").select("*").eq("restaurant_id", restaurantId), "availability") as StaffAvailabilityRow[];
  const weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // Monday = 1
  return activeOn(rows, day).filter((r) => r.weekday === weekday);
}

export async function addTimeOff(
  restaurantId: string,
  input: { staffId: string; startsAt: string; endsAt: string; kind: StaffTimeOffRow["kind"]; status?: StaffTimeOffRow["status"]; source: OpsSource },
) {
  return must(
    await db()
      .from("staff_time_off")
      .insert({
        restaurant_id: restaurantId,
        staff_id: input.staffId,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        kind: input.kind,
        status: input.status ?? "approved",
        source: input.source,
      })
      .select("*")
      .single(),
    "add time off",
  ) as StaffTimeOffRow;
}

export async function coverRulesOn(restaurantId: string, day: string) {
  const rows = must(await db().from("cover_rules").select("*").eq("restaurant_id", restaurantId), "cover rules") as CoverRuleRow[];
  const weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return activeOn(rows, day).filter((r) => r.weekday === null || r.weekday === weekday);
}

// The rota for a week (Monday's date), made if it doesn't exist yet.
export async function rotaWeek(restaurantId: string, weekStart: string, source: OpsSource = "manual") {
  const found = must(
    await db().from("rota_weeks").select("*").eq("restaurant_id", restaurantId).eq("week_start", weekStart).maybeSingle(),
    "rota week",
  ) as RotaWeekRow | null;
  if (found) return found;
  return must(
    await db().from("rota_weeks").insert({ restaurant_id: restaurantId, week_start: weekStart, source }).select("*").single(),
    "new rota week",
  ) as RotaWeekRow;
}

export async function setRotaStatus(restaurantId: string, rotaWeekId: string, status: RotaStatus, by: string) {
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = { status, updated_at: now };
  if (status === "approved") Object.assign(fields, { approved_at: now, approved_by: by });
  if (status === "published") fields.published_at = now;
  must(await db().from("rota_weeks").update(fields).eq("restaurant_id", restaurantId).eq("id", rotaWeekId), "rota status");
}

export async function addShifts(
  restaurantId: string,
  rotaWeekId: string,
  shifts: { staffId: string | null; role: string; businessDate: string; startsAt: string; endsAt: string; breakMinutes?: number; source: OpsSource }[],
) {
  if (!shifts.length) return [];
  return must(
    await db()
      .from("rota_shifts")
      .insert(
        shifts.map((s) => ({
          restaurant_id: restaurantId,
          rota_week_id: rotaWeekId,
          staff_id: s.staffId,
          role: s.role,
          business_date: s.businessDate,
          starts_at: s.startsAt,
          ends_at: s.endsAt,
          break_minutes: s.breakMinutes ?? 0,
          source: s.source,
        })),
      )
      .select("*"),
    "add shifts",
  ) as RotaShiftRow[];
}

export async function shiftsBetween(restaurantId: string, fromDay: string, toDay: string) {
  return must(
    await db().from("rota_shifts").select("*").eq("restaurant_id", restaurantId).gte("business_date", fromDay).lte("business_date", toDay).order("starts_at"),
    "shifts",
  ) as RotaShiftRow[];
}

// Hours actually worked. source: photo (rota photo), export (rota app), manual,
// or assumed (as planned, until told otherwise).
export async function recordActuals(
  restaurantId: string,
  rows: { staffId: string | null; rotaShiftId?: string | null; role?: string | null; businessDate: string; startsAt: string; endsAt: string; breakMinutes?: number; source: OpsSource }[],
) {
  if (!rows.length) return [];
  return must(
    await db()
      .from("shift_actuals")
      .insert(
        rows.map((r) => ({
          restaurant_id: restaurantId,
          staff_id: r.staffId,
          rota_shift_id: r.rotaShiftId ?? null,
          role: r.role ?? null,
          business_date: r.businessDate,
          starts_at: r.startsAt,
          ends_at: r.endsAt,
          break_minutes: r.breakMinutes ?? 0,
          source: r.source,
        })),
      )
      .select("*"),
    "record actual hours",
  ) as ShiftActualRow[];
}

// Paid minutes of a shift (its length less breaks).
export function paidMinutes(s: { starts_at: string; ends_at: string; break_minutes: number }) {
  return Math.max(0, Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60_000) - s.break_minutes);
}
