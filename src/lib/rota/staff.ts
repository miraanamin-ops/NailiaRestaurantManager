import "server-only";
import { logAction, type Actor } from "@/lib/audit";
import { db, must } from "@/lib/ops/db";
import { activeOn, valueOn } from "@/lib/ops/history";
import { listStaff } from "@/lib/ops/staff";
import type { OpsSource, StaffAvailabilityRow, StaffPayRateRow, StaffRow } from "@/lib/ops/types";
import { gbp } from "@/lib/sales/format";
import { findStaff } from "./edits";
import { roleLabel, roleKey } from "./rules";
import type { StaffInput } from "./staff-input";

// The rota's team, saved from WhatsApp ("add Ali, kitchen, £13, weekdays") and
// the staff page (/staff). Pay and availability are history (032): a new rate is
// a new row from today; new availability ends the old pattern today.

export type TeamMember = {
  id: string;
  name: string;
  roles: string[];
  ratePence: number | null;
  maxHours: number | null;
  availability: { weekday: number; starts: string; ends: string }[];
};

const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Everyone on the team today, with today's pay and availability.
export async function team(restaurantId: string, today: string): Promise<TeamMember[]> {
  const [people, pay, avail] = await Promise.all([
    listStaff(restaurantId),
    db().from("staff_pay_rates").select("*").eq("restaurant_id", restaurantId),
    db().from("staff_availability").select("*").eq("restaurant_id", restaurantId).in("kind", ["available", "preferred"]),
  ]);
  const payRows = (must(pay, "pay rates") ?? []) as StaffPayRateRow[];
  const spans = activeOn((must(avail, "availability") ?? []) as StaffAvailabilityRow[], today);
  return people
    .filter((p) => !p.employment_end || p.employment_end >= today)
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      roles: p.roles,
      ratePence: valueOn(payRows.filter((r) => r.staff_id === p.id), today)?.hourly_pence ?? null,
      maxHours: p.max_hours_week === null ? null : Number(p.max_hours_week),
      availability: spans
        .filter((s) => s.staff_id === p.id)
        .map((s) => ({ weekday: s.weekday, starts: s.starts.slice(0, 5), ends: s.ends.slice(0, 5) }))
        .sort((a, b) => a.weekday - b.weekday || a.starts.localeCompare(b.starts)),
    }));
}

// "Mon–Fri all day", "Fri, Sat 17:00–23:59"
export function availabilityText(a: TeamMember["availability"]) {
  if (!a.length) return "no availability set";
  const groups = new Map<string, number[]>();
  for (const s of a) {
    const k = s.starts === "00:00" && s.ends === "23:59" ? "all day" : `${s.starts}–${s.ends === "23:59" ? "close" : s.ends}`;
    groups.set(k, [...(groups.get(k) ?? []), s.weekday]);
  }
  return [...groups]
    .map(([k, days]) => {
      const d = [...new Set(days)].sort();
      const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
      const label = d.length === 7 ? "every day" : run ? `${DAY_SHORT[d[0]]}–${DAY_SHORT[d.at(-1)!]}` : d.map((x) => DAY_SHORT[x]).join(", ");
      return `${label} ${k}`;
    })
    .join("; ");
}

export function memberLine(m: TeamMember) {
  return `- *${m.name}*: ${m.roles.map((r) => roleLabel(roleKey(r)).toLowerCase()).join(", ") || "no role"}, ${m.ratePence !== null ? `${gbp(m.ratePence / 100, true)}/h` : "no rate"}${m.maxHours !== null ? `, max ${m.maxHours}h` : ""}; ${availabilityText(m.availability)}`;
}

// Adds someone, or updates them if they're already on the team (same name).
// Only what's given changes; someone new with no days is free every day, all day.
export async function saveStaff(
  restaurantId: string,
  // staffId: this person (the staff page); spans: their exact week (the staff page), instead of days + one time.
  input: StaffInput & { staffId?: string; spans?: { weekday: number; starts: string; ends: string }[] },
  opts: { today: string; source: OpsSource; actor: Actor },
): Promise<{ member: TeamMember; created: boolean }> {
  const current = await team(restaurantId, opts.today);
  const existing = input.staffId ? current.find((m) => m.id === input.staffId) : findStaff(current, input.name);
  if (input.staffId && !existing) throw new Error("That person isn't on this restaurant's team");
  let id = existing?.id ?? null;
  const now = new Date().toISOString();
  if (existing) {
    must(
      await db()
        .from("staff")
        .update({
          display_name: input.name.trim() || existing.name,
          ...(input.roles.length ? { roles: input.roles } : {}),
          ...(input.maxHours !== null || input.staffId ? { max_hours_week: input.maxHours } : {}),
          updated_at: now,
        })
        .eq("restaurant_id", restaurantId)
        .eq("id", existing.id),
      "update staff",
    );
  } else {
    const row = must(
      await db()
        .from("staff")
        .insert({ restaurant_id: restaurantId, display_name: input.name.trim(), roles: input.roles, max_hours_week: input.maxHours, employment_start: opts.today, source: opts.source })
        .select("*")
        .single(),
      "add staff",
    ) as StaffRow;
    id = row.id;
  }
  if (input.ratePence !== null && input.ratePence !== existing?.ratePence) {
    must(
      await db().from("staff_pay_rates").insert({ restaurant_id: restaurantId, staff_id: id, hourly_pence: input.ratePence, effective_from: opts.today, recorded_at: new Date().toISOString(), source: opts.source }),
      "set pay rate",
    );
  }
  const days = input.days ?? (existing ? null : [1, 2, 3, 4, 5, 6, 7]);
  if (input.spans) await replaceAvailability(restaurantId, id!, input.spans, opts.today, opts.source);
  else if (days) await replaceAvailability(restaurantId, id!, days.map((weekday) => ({ weekday, starts: input.starts ?? "00:00", ends: input.ends ?? "23:59" })), opts.today, opts.source);
  else if (input.starts && input.ends && existing) {
    // New times for the same days
    await replaceAvailability(restaurantId, id!, [...new Set(existing.availability.map((a) => a.weekday))].map((weekday) => ({ weekday, starts: input.starts!, ends: input.ends! })), opts.today, opts.source);
  }
  const member = (await team(restaurantId, opts.today)).find((m) => m.id === id)!;
  await logAction({
    restaurantId,
    actor: opts.actor,
    action: "rota_staff",
    detail: `${existing ? "Updated" : "Added"} ${member.name} on the rota team (${memberLine(member).replace(/^- \*.*?\*: /, "")})`,
    data: { staff_id: id, created: !existing },
  });
  return { member, created: !existing };
}

// A new weekly pattern from today: rows that started before today end today; any from today are replaced.
export async function replaceAvailability(restaurantId: string, staffId: string, spans: { weekday: number; starts: string; ends: string }[], today: string, source: OpsSource) {
  must(
    await db().from("staff_availability").delete().eq("restaurant_id", restaurantId).eq("staff_id", staffId).gte("effective_from", today),
    "clear availability",
  );
  must(
    await db().from("staff_availability").update({ effective_to: today }).eq("restaurant_id", restaurantId).eq("staff_id", staffId).lt("effective_from", today).or(`effective_to.is.null,effective_to.gt.${today}`),
    "end availability",
  );
  if (!spans.length) return;
  must(
    await db()
      .from("staff_availability")
      .insert(spans.map((s) => ({ restaurant_id: restaurantId, staff_id: staffId, weekday: s.weekday, starts: s.starts, ends: s.ends, kind: "available", effective_from: today, source }))),
    "add availability",
  );
}

// Off the team from today (their past shifts and pay stay, as wage records).
export async function removeStaff(restaurantId: string, staffId: string, opts: { today: string; actor: Actor }) {
  const yesterday = new Date(Date.parse(`${opts.today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const row = must(await db().from("staff").select("*").eq("restaurant_id", restaurantId).eq("id", staffId).maybeSingle(), "staff") as StaffRow | null;
  if (!row) return null;
  // Someone added today and removed today: their start moves back a day too (the end can't be before the start).
  const startFix = row.employment_start && row.employment_start > yesterday ? { employment_start: yesterday } : {};
  must(
    await db().from("staff").update({ ...startFix, employment_end: yesterday, updated_at: new Date().toISOString() }).eq("restaurant_id", restaurantId).eq("id", staffId),
    "end employment",
  );
  await logAction({ restaurantId, actor: opts.actor, action: "rota_staff", detail: `Removed ${row.display_name} from the rota team`, data: { staff_id: staffId, removed: true } });
  return row.display_name;
}
