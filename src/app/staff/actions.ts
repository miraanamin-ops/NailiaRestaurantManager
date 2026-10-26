"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { londonYmd } from "@/lib/clock";
import { db, must } from "@/lib/ops/db";
import { getRestaurant } from "@/lib/onboarding/store";
import { DEFAULT_SETTINGS, ROLES, rotaSettings } from "@/lib/rota/rules";
import { removeStaff, saveStaff } from "@/lib/rota/staff";
import { parseRate } from "@/lib/rota/staff-input";

// The Team page's save buttons. Every change is in the activity log.

async function own(restaurantId: string) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(`/staff?r=${restaurantId}`)}`);
  if (!owner.restaurantIds.includes(restaurantId)) throw new Error("Not your restaurant");
  return getRestaurant(restaurantId);
}

const back = (rid: string, params: string): never => redirect(`/staff?r=${rid}&${params}`);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Add someone, or change someone (staff_id set).
export async function saveMember(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));
  const name = get("name");
  const roles = ROLES.filter((role) => form.get(`role_${role}`) === "yes");
  const rate = get("rate") ? parseRate(get("rate").startsWith("£") ? get("rate") : `£${get("rate")}`) : null;
  const max = get("max") ? Number(get("max")) : null;
  if (!name || name.length > 40) back(r.id, `error=${encodeURIComponent("Please give a name (up to 40 letters).")}`);
  if (!roles.length) back(r.id, `error=${encodeURIComponent(`Pick at least one role for ${name}.`)}`);
  if (get("rate") && rate === null) back(r.id, `error=${encodeURIComponent(`Couldn't read the hourly rate for ${name}. Try e.g. 12.50`)}`);
  if (max !== null && !(max > 0 && max <= 80)) back(r.id, `error=${encodeURIComponent("Max hours a week should be between 1 and 80 (or empty for no limit).")}`);
  const spans: { weekday: number; starts: string; ends: string }[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    if (form.get(`day_${wd}`) !== "yes") continue;
    const starts = get(`from_${wd}`) || "00:00";
    const ends = get(`to_${wd}`) || "23:59";
    if (!TIME.test(starts) || !TIME.test(ends)) back(r.id, `error=${encodeURIComponent("Times should look like 17:00.")}`);
    spans.push({ weekday: wd, starts, ends });
  }
  const staffId = get("staff_id") || undefined;
  await saveStaff(r.id, { name, roles, ratePence: rate, maxHours: max, days: null, starts: null, ends: null, staffId, spans }, { today: londonYmd(new Date()), source: "manual", actor: "owner" });
  back(r.id, `saved=${encodeURIComponent(staffId ? `${name} updated.` : `${name} added to the team.`)}`);
}

export async function removeMember(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));
  const name = await removeStaff(r.id, get("staff_id"), { today: londonYmd(new Date()), actor: "owner" });
  back(r.id, `saved=${encodeURIComponent(name ? `${name} is off the team.` : "Nothing changed.")}`);
}

// Staffing rules per role, and shift lengths and warnings.
export async function saveRules(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));
  const num = (k: string) => (get(k) === "" ? null : Number(get(k)));
  const rows = [];
  for (const role of ROLES) {
    const min = num(`min_${role}`);
    const per = num(`per_${role}`);
    if (min === null && per === null) continue;
    if (min !== null && !(Number.isInteger(min) && min >= 0 && min <= 20)) back(r.id, `error=${encodeURIComponent("The minimum on shift should be a whole number from 0 to 20.")}`);
    if (per !== null && !(per > 0 && per <= 500)) back(r.id, `error=${encodeURIComponent("Orders per extra person should be more than 0 (or empty for never).")}`);
    rows.push({ restaurant_id: r.id, role, min_on_shift: min ?? 0, orders_per_extra_staff: per, source: "manual" as const, updated_at: new Date().toISOString() });
  }
  if (rows.length) must(await db().from("rota_rules").upsert(rows, { onConflict: "restaurant_id,role" }), "save rota rules");
  const before = (r as { rota_settings?: Record<string, unknown> | null }).rota_settings ?? null;
  const settings = rotaSettings({
    min_shift_hours: num("min_shift") ?? DEFAULT_SETTINGS.min_shift_hours,
    max_shift_hours: num("max_shift") ?? DEFAULT_SETTINGS.max_shift_hours,
    flag_week_hours: num("week_hours") ?? DEFAULT_SETTINGS.flag_week_hours,
    flag_rest_hours: num("rest_hours") ?? DEFAULT_SETTINGS.flag_rest_hours,
  });
  must(await db().from("restaurants").update({ rota_settings: settings }).eq("id", r.id), "save rota settings");
  await logAction({ restaurantId: r.id, actor: "owner", action: "rota_settings", detail: "Changed the rota rules", data: { before, after: settings, rules: rows.map((x) => ({ role: x.role, min: x.min_on_shift, per: x.orders_per_extra_staff })) } });
  back(r.id, `saved=${encodeURIComponent("Rota rules saved.")}`);
}
