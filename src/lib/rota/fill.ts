// The rota suggester's fill (docs/pilot-sprint.md, "Rota suggester"): a simple
// greedy fill, not an optimiser. Day by day (the busiest forecast day first, so
// if the team runs short it's on a quiet day), role by role, it finds the first
// half hour short of people and gives it to the cheapest available person who
// fits the rules (their role, their availability, one shift a day, their weekly
// cap, the 48-hour and 11-hour-rest limits, shifts of 4 to 10 hours). Someone
// who usually works that day (past rotas) counts as 50p an hour cheaper. If
// nobody fits, the shift stays open. Then the owner's swaps, then cost, labour %
// and anything to flag. No imports beyond ./rules and ./types: unit-tested
// (tests/rota-fill.test.ts).
import { ALL_DAY, availabilitySpan, needFor, roleKey, roleLabel, SLOT, span12, type RotaSettings, type Span } from "./rules";
import type { RotaRule, RotaStaff, TimeSpan, Weekday } from "./types";

// The owner's edits, kept on the rota week and applied on every re-fill.
export type Adjustment =
  | { type: "unavailable"; staffId: string; dates: string[] } // "Ali can't do Friday"
  | { type: "available"; staffId: string; dates: string[]; starts?: string; ends?: string } // "Ali can do Sunday"
  | { type: "swap"; a: string; b: string; dates: string[] }; // "swap Sara and Bilal on Sunday"

export type FillDay = {
  date: string;
  weekday: Weekday;
  open: Span[]; // opening hours (rules.openingFor); empty = closed
  ordersByHour: Record<number, number>; // London hour -> forecast orders (empty without a forecast)
  orders: number | null;
  salesPence: number | null; // forecast sales, before VAT
};

export type FillInput = {
  staff: RotaStaff[];
  rules: RotaRule[]; // rules.effectiveRules
  settings: RotaSettings;
  days: FillDay[]; // the 7 days, Monday first
  basis: "forecast" | "minimum"; // minimum: opening hours and minimum staffing only
  adjustments?: Adjustment[];
  timeOff?: Record<string, string[]>; // staff id -> dates they're off (approved holiday, sickness)
  usual?: Record<string, Partial<Record<number, number>>>; // staff id -> weekday -> weeks they worked it lately
};

export type PlannedShift = { staffId: string | null; role: string; date: string; start: number; end: number };

// costPence: hours x rate; for an open shift, an estimate at the role's average rate (estimated: true).
export type CostedShift = PlannedShift & { name: string | null; hours: number; costPence: number | null; estimated?: boolean };

export type DayPlan = {
  date: string;
  weekday: Weekday;
  open: Span[];
  orders: number | null;
  salesPence: number | null;
  shifts: CostedShift[];
  hours: number;
  costPence: number;
  labourPct: number | null;
};

export type RotaFlag = {
  kind: "over_week" | "over_cap" | "short_rest" | "open_shift" | "outside_availability" | "wrong_role" | "no_rate";
  text: string;
  staffId?: string;
  date?: string;
};

export type StaffWeek = { staffId: string; name: string; hours: number; costPence: number | null; shifts: number };

export type RotaPlan = {
  basis: "forecast" | "minimum";
  days: DayPlan[];
  totals: { hours: number; costPence: number; salesPence: number | null; labourPct: number | null; salesDays: number; openDays: number; openShiftHours: number };
  byStaff: StaffWeek[];
  flags: RotaFlag[];
  notes: string[]; // edits that couldn't be done ("Sara isn't on Sunday")
};

const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const dayShort = (weekday: number) => DAY_SHORT[weekday];

// Someone who usually works a weekday counts as this much cheaper an hour.
export const USUAL_BONUS_PENCE = 50;
// Worked that weekday in at least this many of the recent weeks = "usually".
export const USUAL_WEEKS = 2;

const round1 = (n: number) => Math.round(n * 10) / 10;
const hoursOf = (s: { start: number; end: number }) => (s.end - s.start) / 60;

// The whole thing: fill, swaps, then costs and flags.
export function buildPlan(input: FillInput): RotaPlan {
  const filled = fill(input);
  const swapped = applySwaps(filled, input);
  return summarise(swapped.shifts, input, swapped.notes);
}

// When someone can work on a day: their usual availability, plus "can do" edits,
// minus "can't do" edits and time off.
export function availableOn(p: RotaStaff, day: Pick<FillDay, "date" | "weekday">, input: Pick<FillInput, "adjustments" | "timeOff">): Span[] {
  const adj = input.adjustments ?? [];
  if ((input.timeOff?.[p.id] ?? []).includes(day.date)) return [];
  if (adj.some((a) => a.type === "unavailable" && a.staffId === p.id && a.dates.includes(day.date))) return [];
  const extra: TimeSpan[] = adj
    .filter((a): a is Extract<Adjustment, { type: "available" }> => a.type === "available" && a.staffId === p.id && a.dates.includes(day.date))
    .map((a) => (a.starts && a.ends ? { starts: a.starts, ends: a.ends } : ALL_DAY));
  return [...(p.availability[day.weekday] ?? []), ...extra].map(availabilitySpan);
}

const hasRole = (p: RotaStaff, role: string) => p.roles.some((r) => roleKey(r) === role);

export function fill(input: FillInput): PlannedShift[] {
  const { settings, staff } = input;
  const minLen = settings.min_shift_hours * 60;
  const maxLen = settings.max_shift_hours * 60;
  const shifts: PlannedShift[] = [];
  const index = new Map(input.days.map((d, i) => [d.date, i]));
  const abs = (s: PlannedShift) => {
    const base = (index.get(s.date) ?? 0) * 1440;
    return { start: base + s.start, end: base + s.end };
  };
  const weekHours = (id: string) => shifts.filter((s) => s.staffId === id).reduce((n, s) => n + hoursOf(s), 0);
  const restOk = (id: string, date: string, w: Span) => {
    const di = (index.get(date) ?? 0) * 1440;
    const mine = { start: di + w.start, end: di + w.end };
    return shifts
      .filter((s) => s.staffId === id)
      .every((s) => {
        const o = abs(s);
        const gap = o.end <= mine.start ? mine.start - o.end : mine.end <= o.start ? o.start - mine.end : -1;
        return gap >= settings.flag_rest_hours * 60;
      });
  };

  // Busiest first (by forecast orders); without a forecast, Monday to Sunday.
  const days = input.basis === "forecast" ? [...input.days].sort((a, b) => (b.orders ?? 0) - (a.orders ?? 0) || a.date.localeCompare(b.date)) : input.days;
  for (const day of days) {
    for (const rule of input.rules) {
      for (const span of day.open) {
        const n = Math.ceil((span.end - span.start) / SLOT);
        const slotAt = (i: number) => span.start + i * SLOT;
        const need = Array.from({ length: n }, (_, i) => {
          const hour = Math.floor(slotAt(i) / 60) % 24;
          return needFor(rule, input.basis === "forecast" ? (day.ordersByHour[hour] ?? 0) : 0);
        });
        const covered = Array.from({ length: n }, () => 0);
        const cover = (w: Span) => {
          for (let i = 0; i < n; i++) if (slotAt(i) >= w.start && Math.min(slotAt(i) + SLOT, span.end) <= w.end) covered[i]++;
        };

        // The shift for the first short half hour at or after `from`: the short run
        // from there, stretched to the minimum length, kept inside the opening
        // hours. A run longer than the longest shift is shared out evenly (an
        // 11-hour day is an opening and a closing shift of 5.5 hours, not 10 + 4).
        const spanLen = span.end - span.start;
        const shortest = Math.min(minLen, spanLen);
        const shiftFrom = (s0: number, short: (i: number) => boolean) => {
          let e = s0;
          while (e < n && short(e)) e++;
          const run = (e - s0) * SLOT;
          const pieces = Math.ceil(run / maxLen);
          const even = pieces > 1 ? Math.ceil(run / pieces / SLOT) * SLOT : run;
          const len = Math.min(Math.max(even, shortest), maxLen, spanLen);
          let start = slotAt(s0);
          let end = start + len;
          if (end > span.end) {
            end = span.end;
            start = Math.max(span.start, end - len);
          }
          return { start, end };
        };

        // 1. People. A half hour nobody can take is marked unfillable and passed over.
        const unfillable = Array.from({ length: n }, () => 0);
        for (let guard = 0; guard < 400; guard++) {
          const s0 = covered.findIndex((c, i) => c + unfillable[i] < need[i]);
          if (s0 === -1) break;
          const { start, end } = shiftFrom(s0, (i) => covered[i] + unfillable[i] < need[i]);
          const t0 = slotAt(s0);
          // What this person could work: all of start..end, or the part they're
          // free for from the short half hour (at least the minimum length).
          type Pick = { p: RotaStaff; w: Span; full: boolean; score: number; hours: number };
          const pickFor = (p: RotaStaff): Pick | null => {
            if (!hasRole(p, rule.role)) return null;
            if (shifts.some((s) => s.staffId === p.id && s.date === day.date)) return null;
            const avail = availableOn(p, day, input);
            let w: Span | null = null;
            let full = false;
            if (avail.some((a) => a.start <= start && end <= a.end)) {
              w = { start, end };
              full = true;
            } else {
              const a = avail.find((x) => x.start <= t0 && t0 + SLOT <= x.end);
              if (a) {
                const ws = Math.max(a.start, span.start);
                const we = Math.min(a.end, span.end);
                let st = t0;
                let en = Math.min(we, end, st + maxLen);
                if (en - st < shortest) st = Math.max(ws, en - shortest);
                if (en - st < shortest) en = Math.min(we, st + shortest);
                if (en - st >= shortest) w = { start: st, end: en };
              }
            }
            if (!w) return null;
            const hours = weekHours(p.id);
            const cap = Math.min(p.max_hours_week ?? Infinity, settings.flag_week_hours);
            if (hours + hoursOf(w) > cap + 1e-9) return null;
            if (!restOk(p.id, day.date, w)) return null;
            const usual = (input.usual?.[p.id]?.[day.weekday] ?? 0) >= USUAL_WEEKS ? USUAL_BONUS_PENCE : 0;
            return { p, w, full, score: (p.hourly_rate_pence ?? 1_000_000) - usual, hours };
          };
          const picks = staff.map(pickFor).filter((x): x is Pick => x !== null);
          picks.sort((x, y) => x.score - y.score || Number(y.full) - Number(x.full) || x.hours - y.hours || x.p.name.localeCompare(y.p.name));
          const chosen = picks[0];
          if (!chosen) {
            unfillable[s0]++;
            continue;
          }
          shifts.push({ staffId: chosen.p.id, role: rule.role, date: day.date, ...chosen.w });
          cover(chosen.w);
        }

        // 2. What nobody could take becomes open shifts, joined up into proper shifts.
        for (let guard = 0; guard < 200; guard++) {
          const s0 = covered.findIndex((c, i) => c < need[i]);
          if (s0 === -1) break;
          const w = shiftFrom(s0, (i) => covered[i] < need[i]);
          shifts.push({ staffId: null, role: rule.role, date: day.date, ...w });
          cover(w);
        }
      }
    }
  }
  return shifts;
}

// "swap Sara and Bilal on Sunday": their shifts that day change hands (one
// with no shift gives theirs to the other). Checked afterwards like any shift.
export function applySwaps(shifts: PlannedShift[], input: Pick<FillInput, "adjustments" | "staff" | "days">) {
  const notes: string[] = [];
  let out = shifts.map((s) => ({ ...s }));
  const name = (id: string) => input.staff.find((p) => p.id === id)?.name ?? "someone";
  for (const a of input.adjustments ?? []) {
    if (a.type !== "swap") continue;
    let moved = 0;
    for (const date of a.dates) {
      const day = input.days.find((d) => d.date === date);
      const label = day ? dayShort(day.weekday) : date;
      const ofA = out.filter((s) => s.date === date && s.staffId === a.a);
      const ofB = out.filter((s) => s.date === date && s.staffId === a.b);
      if (!ofA.length && !ofB.length) {
        if (a.dates.length === 1) notes.push(`Couldn't swap ${name(a.a)} and ${name(a.b)} on ${label}: neither is on the rota that day.`);
        continue;
      }
      out = out.map((s) => (s.date !== date ? s : s.staffId === a.a ? { ...s, staffId: a.b } : s.staffId === a.b ? { ...s, staffId: a.a } : s));
      moved++;
    }
    if (!moved && a.dates.length > 1) notes.push(`Couldn't swap ${name(a.a)} and ${name(a.b)}: neither is on the rota those days.`);
  }
  return { shifts: out, notes };
}

// Costs (hours x hourly rate, to the penny), labour % of forecast sales per day
// and for the week, and what the owner should look at.
export function summarise(shifts: PlannedShift[], input: FillInput, notes: string[] = []): RotaPlan {
  const people = new Map(input.staff.map((p) => [p.id, p]));
  const costed: CostedShift[] = shifts.map((s) => {
    const p = s.staffId ? people.get(s.staffId) : undefined;
    const hours = hoursOf(s);
    if (s.staffId === null) {
      // Someone will have to work it: costed at the average rate of the people in that role.
      const rate = averageRate(input.staff, s.role);
      return { ...s, name: null, hours, costPence: rate === null ? null : Math.round(hours * rate), estimated: true };
    }
    const rate = p?.hourly_rate_pence ?? null;
    return { ...s, name: p?.name ?? null, hours, costPence: rate === null ? null : Math.round(hours * rate) };
  });
  const days: DayPlan[] = input.days.map((d) => {
    const mine = costed.filter((s) => s.date === d.date).sort((a, b) => a.start - b.start || a.role.localeCompare(b.role) || (a.name ?? "").localeCompare(b.name ?? ""));
    const costPence = mine.reduce((n, s) => n + (s.costPence ?? 0), 0);
    return {
      date: d.date,
      weekday: d.weekday,
      open: d.open,
      orders: d.orders,
      salesPence: d.salesPence,
      shifts: mine,
      hours: round1(mine.reduce((n, s) => n + s.hours, 0)),
      costPence,
      labourPct: labourPct(costPence, d.salesPence),
    };
  });
  // The week's labour %: only over days with a sales forecast, so a missing day doesn't flatter it.
  const withSales = days.filter((d) => d.salesPence && d.salesPence > 0);
  const salesPence = withSales.length ? withSales.reduce((n, d) => n + d.salesPence!, 0) : null;
  const costWithSales = withSales.reduce((n, d) => n + d.costPence, 0);
  const totals = {
    hours: round1(days.reduce((n, d) => n + d.hours, 0)),
    costPence: days.reduce((n, d) => n + d.costPence, 0),
    salesPence,
    labourPct: salesPence ? labourPct(costWithSales, salesPence) : null,
    salesDays: withSales.length,
    openDays: days.filter((d) => d.open.length).length,
    openShiftHours: round1(costed.filter((s) => s.staffId === null).reduce((n, s) => n + s.hours, 0)),
  };

  const byStaff: StaffWeek[] = input.staff
    .map((p) => {
      const mine = costed.filter((s) => s.staffId === p.id);
      const hours = round1(mine.reduce((n, s) => n + s.hours, 0));
      return { staffId: p.id, name: p.name, hours, costPence: p.hourly_rate_pence === null ? null : mine.reduce((n, s) => n + (s.costPence ?? 0), 0), shifts: mine.length };
    })
    .filter((s) => s.shifts > 0)
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

  return { basis: input.basis, days, totals, byStaff, flags: flagsFor(costed, input), notes };
}

export function averageRate(staff: RotaStaff[], role: string) {
  const rates = staff.filter((p) => hasRole(p, role) && p.hourly_rate_pence !== null).map((p) => p.hourly_rate_pence!);
  return rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
}

export function labourPct(costPence: number, salesPence: number | null) {
  return salesPence && salesPence > 0 ? round1((costPence / salesPence) * 100) : null;
}

export function flagsFor(shifts: CostedShift[], input: FillInput): RotaFlag[] {
  const flags: RotaFlag[] = [];
  const { settings } = input;
  const index = new Map(input.days.map((d, i) => [d.date, i]));
  const weekday = (date: string) => input.days[index.get(date) ?? 0]?.weekday ?? 1;
  const when = (s: PlannedShift) => `${dayShort(weekday(s.date))} ${span12(s.start, s.end)}`;

  for (const s of shifts) {
    if (s.staffId === null) {
      flags.push({ kind: "open_shift", date: s.date, text: `Open shift: ${roleLabel(s.role).toLowerCase()} ${when(s)}, nobody free` });
    }
  }
  for (const p of input.staff) {
    const mine = shifts.filter((s) => s.staffId === p.id).sort((a, b) => (index.get(a.date) ?? 0) - (index.get(b.date) ?? 0) || a.start - b.start);
    if (!mine.length) continue;
    const hours = round1(mine.reduce((n, s) => n + s.hours, 0));
    if (hours > settings.flag_week_hours) {
      flags.push({ kind: "over_week", staffId: p.id, text: `${p.name}: ${hours} hours this week, over ${settings.flag_week_hours}` });
    } else if (p.max_hours_week !== null && hours > p.max_hours_week) {
      flags.push({ kind: "over_cap", staffId: p.id, text: `${p.name}: ${hours} hours, more than their ${p.max_hours_week}-hour limit` });
    }
    for (let i = 1; i < mine.length; i++) {
      const a = mine[i - 1];
      const b = mine[i];
      const gap = (index.get(b.date)! * 1440 + b.start - (index.get(a.date)! * 1440 + a.end)) / 60;
      if (gap < settings.flag_rest_hours) {
        flags.push({ kind: "short_rest", staffId: p.id, date: b.date, text: `${p.name}: only ${round1(Math.max(0, gap))} hours off between ${dayShort(weekday(a.date))} and ${dayShort(weekday(b.date))} (needs ${settings.flag_rest_hours})` });
      }
    }
    for (const s of mine) {
      const day = { date: s.date, weekday: weekday(s.date) as Weekday };
      if (!hasRole(p, s.role)) flags.push({ kind: "wrong_role", staffId: p.id, date: s.date, text: `${p.name} isn't set up for ${roleLabel(s.role).toLowerCase()} (${when(s)})` });
      if (!availableOn(p, day, input).some((a) => a.start <= s.start && s.end <= a.end)) {
        flags.push({ kind: "outside_availability", staffId: p.id, date: s.date, text: `${p.name} isn't usually free ${when(s)}` });
      }
    }
    if (p.hourly_rate_pence === null) flags.push({ kind: "no_rate", staffId: p.id, text: `${p.name} has no hourly rate yet, so their hours aren't costed` });
  }
  return flags;
}

// How often each person worked each weekday in past rotas: staff id -> weekday -> weeks.
export function usualFromHistory(rows: { staff_id: string | null; business_date: string }[]) {
  const seen = new Map<string, Set<string>>(); // staff|weekday -> distinct weeks
  for (const r of rows) {
    if (!r.staff_id) continue;
    const d = new Date(`${r.business_date}T12:00:00Z`);
    const wd = ((d.getUTCDay() + 6) % 7) + 1;
    const monday = new Date(d.getTime() - (wd - 1) * 86_400_000).toISOString().slice(0, 10);
    const k = `${r.staff_id}|${wd}`;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(monday);
  }
  const out: Record<string, Partial<Record<number, number>>> = {};
  for (const [k, weeks] of seen) {
    const [id, wd] = k.split("|");
    (out[id] ??= {})[Number(wd)] = weeks.size;
  }
  return out;
}
