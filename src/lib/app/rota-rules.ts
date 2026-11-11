// The rota in the app (step 50): the Reports tab's Rota section (this week and next)
// and Today's "Who's on today", as plain code (tests/app-rota.test.ts). Made from the
// week's saved plan (rota_weeks.summary, the same one the website's Team page, the
// published link and the PDF draw), never re-filled here. The owner sees costs and the
// labour %; the shared link for the team never does (lib/rota/view.ts).
import type { RotaPlan } from "@/lib/rota/fill";
import { roleLabel, span12 } from "@/lib/rota/rules";

export type RotaWeekLike = { week_start: string; status: string | null; summary: (Pick<RotaPlan, "days" | "totals" | "flags"> & { basis?: string }) | null; draft_id: string | null; share_token: string | null };

export type AppShift = { name: string | null; role: string; time: string; hours: number };
export type AppRotaDay = { date: string; label: string; closed: boolean; shifts: AppShift[]; hours: number; costPence: number; labourPct: number | null };
export type AppRotaWeek = {
  weekStart: string;
  label: string; // "Mon 9 – Sun 15 Nov"
  // approved: published to the team; waiting: suggested, waiting for the owner (in the Inbox);
  // none: no rota for that week yet (it's suggested on Thursday).
  status: "approved" | "waiting" | "none";
  draftId: string | null;
  days: AppRotaDay[];
  totals: { hours: number; costPence: number; labourPct: number | null; target: number | null; overTarget: boolean } | null;
  flags: string[];
  openShifts: number;
  // The team's link (no pay or costs), once approved.
  shareToken: string | null;
};

const ymdDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
export const addDays = (ymd: string, n: number) => new Date(ymdDate(ymd).getTime() + n * 86_400_000).toISOString().slice(0, 10);
// Monday = 1 ... Sunday = 7
export const weekdayOf = (ymd: string) => ((ymdDate(ymd).getUTCDay() + 6) % 7) + 1;
export const mondayOf = (ymd: string) => addDays(ymd, 1 - weekdayOf(ymd));

const short = (ymd: string) => ymdDate(ymd).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
const long = (ymd: string) => ymdDate(ymd).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export function weekLabel(weekStart: string) {
  const end = addDays(weekStart, 6);
  const month = (ymd: string) => ymdDate(ymd).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${short(weekStart)}${month(weekStart) !== month(end) ? ` ${month(weekStart)}` : ""} – ${short(end)} ${month(end)}`;
}

const statusOf = (w: RotaWeekLike | null): AppRotaWeek["status"] => (!w?.summary ? "none" : w.status === "published" || w.status === "approved" ? "approved" : "waiting");

export function appRotaWeek(w: RotaWeekLike | null, weekStart: string, labourTarget: number | null): AppRotaWeek {
  const plan = w?.summary ?? null;
  const days: AppRotaDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const d = plan?.days.find((x) => x.date === date);
    const shifts = (d?.shifts ?? [])
      .slice()
      .sort((a, b) => a.start - b.start || Number(!a.name) - Number(!b.name))
      .map((s) => ({ name: s.name, role: roleLabel(s.role), time: span12(s.start, s.end), hours: s.hours }));
    return { date, label: long(date), closed: Boolean(d && !d.open.length), shifts, hours: d?.hours ?? 0, costPence: d?.costPence ?? 0, labourPct: d?.labourPct ?? null };
  });
  const totals = plan
    ? {
        hours: plan.totals.hours,
        costPence: plan.totals.costPence,
        labourPct: plan.totals.labourPct,
        target: labourTarget,
        overTarget: Boolean(labourTarget && plan.totals.labourPct != null && plan.totals.labourPct > labourTarget),
      }
    : null;
  const status = statusOf(w);
  return {
    weekStart,
    label: weekLabel(weekStart),
    status,
    draftId: status === "waiting" ? (w?.draft_id ?? null) : null,
    days,
    totals,
    flags: (plan?.flags ?? []).map((f) => f.text).slice(0, 5),
    openShifts: days.reduce((n, d) => n + d.shifts.filter((s) => !s.name).length, 0),
    shareToken: status === "approved" ? (w?.share_token ?? null) : null,
  };
}

// Today's card: who's on, from this week's rota (approved, or the suggestion if
// that's all there is, said so). null: no rota this week.
export function todayOnRota(week: AppRotaWeek, today: string) {
  if (week.status === "none") return null;
  const day = week.days.find((d) => d.date === today);
  if (!day) return null;
  return { date: today, closed: day.closed, suggested: week.status === "waiting", shifts: day.shifts };
}
