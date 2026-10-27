// The rota suggester's rules (docs/pilot-sprint.md, "Rota suggester"): roles,
// per-restaurant settings with sensible defaults, opening hours as minutes, and
// how many people each role needs in each half hour.
// No imports beyond ./types, so it's unit-tested (tests/rota-rules.test.ts).
import type { RotaRule, RotaStaff, TimeSpan } from "./types";

// The four roles a rota fills. Older staff rows may say "chef", "waiter"... (roleKey).
export const ROLES = ["manager", "kitchen", "front", "delivery"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<string, string> = { manager: "Manager", kitchen: "Kitchen", front: "Front of house", delivery: "Delivery" };
export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);

const ROLE_WORDS: [RegExp, Role][] = [
  [/^(manager|managers|gm|general manager|supervisor|shift lead|shift manager)$/, "manager"],
  [/^(kitchen|chef|chefs|cook|cooks|head chef|sous chef|kitchen porter|kp|line cook)$/, "kitchen"],
  [/^(front|foh|front of house|front-of-house|waiter|waiters|waitress|waiting staff|server|servers|cashier)$/, "front"],
  [/^(delivery|deliveries|driver|drivers|rider|riders|courier|couriers)$/, "delivery"],
];

// "Chef" -> "kitchen", "FOH" -> "front"; anything else stays as written (lower case).
export function roleKey(word: string): string {
  const w = word.trim().toLowerCase().replace(/\s+/g, " ");
  return ROLE_WORDS.find(([re]) => re.test(w))?.[1] ?? w;
}

export function isRoleWord(word: string) {
  const w = word.trim().toLowerCase().replace(/\s+/g, " ");
  return ROLE_WORDS.some(([re]) => re.test(w));
}

// ---------- Settings ----------

export type RotaSettings = {
  min_shift_hours: number; // no shift shorter (unless the restaurant is open for less)
  max_shift_hours: number; // no shift longer
  flag_week_hours: number; // flag anyone over this many hours in the week (the 48-hour working time limit)
  flag_rest_hours: number; // flag anyone with less than this between two shifts (11 hours' daily rest)
};

export const DEFAULT_SETTINGS: RotaSettings = { min_shift_hours: 4, max_shift_hours: 10, flag_week_hours: 48, flag_rest_hours: 11 };

const sane = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// restaurants.rota_settings, with the defaults for anything missing or odd.
export function rotaSettings(saved: Record<string, unknown> | null | undefined): RotaSettings {
  const s = saved ?? {};
  const min = sane(s.min_shift_hours, 1, 12) ?? DEFAULT_SETTINGS.min_shift_hours;
  const max = sane(s.max_shift_hours, 1, 16) ?? DEFAULT_SETTINGS.max_shift_hours;
  return {
    min_shift_hours: Math.min(min, max),
    max_shift_hours: Math.max(min, max),
    flag_week_hours: sane(s.flag_week_hours, 1, 100) ?? DEFAULT_SETTINGS.flag_week_hours,
    flag_rest_hours: sane(s.flag_rest_hours, 0, 24) ?? DEFAULT_SETTINGS.flag_rest_hours,
  };
}

// ---------- Staffing rules ----------

// With no rule saved for a role: one in the kitchen and one front of house
// whenever open, plus one more per 12 / 15 forecast orders an hour; delivery
// only when busy (one per 10 orders an hour); a manager isn't required.
export const DEFAULT_RULES: Record<Role, RotaRule> = {
  manager: { role: "manager", min_on_shift: 0, orders_per_extra_staff: null },
  kitchen: { role: "kitchen", min_on_shift: 1, orders_per_extra_staff: 12 },
  front: { role: "front", min_on_shift: 1, orders_per_extra_staff: 15 },
  delivery: { role: "delivery", min_on_shift: 0, orders_per_extra_staff: 10 },
};

// The rules the fill uses: every saved rule, plus the default for any role
// someone on the team has but no rule covers (a role nobody has gets no default,
// so a restaurant without drivers isn't told it's short of drivers every day).
export function effectiveRules(saved: RotaRule[], staff: Pick<RotaStaff, "roles">[]): RotaRule[] {
  const out = new Map<string, RotaRule>();
  for (const r of saved) out.set(roleKey(r.role), { ...r, role: roleKey(r.role) });
  const roles = new Set(staff.flatMap((p) => p.roles.map(roleKey)));
  for (const role of ROLES) if (!out.has(role) && roles.has(role)) out.set(role, DEFAULT_RULES[role]);
  return [...out.values()].sort((a, b) => order(a.role) - order(b.role));
}

const order = (role: string) => {
  const i = (ROLES as readonly string[]).indexOf(role);
  return i === -1 ? ROLES.length : i;
};

// How many people a role needs in an hour with this many forecast orders.
export function needFor(rule: RotaRule, ordersInHour: number) {
  const extra = rule.orders_per_extra_staff && ordersInHour > 0 ? Math.floor(ordersInHour / rule.orders_per_extra_staff) : 0;
  return rule.min_on_shift + extra;
}

// ---------- Opening hours ----------

export const SLOT = 30; // minutes: the fill works in half hours

// Minutes after midnight of the trading day; an end past midnight is over 1440.
export type Span = { start: number; end: number };

const toMinutes = (t: string) => {
  const m = t.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 ? h * 60 + min : null;
};

// "12:00 – 22:00" / "12:00 – 15:00, 18:00 – 23:00" / "18:00 – 02:00" / "Closed" -> spans.
export function openSpans(text: string | null | undefined): Span[] {
  if (!text || /closed/i.test(text)) return [];
  const out: Span[] = [];
  for (const range of text.split(",")) {
    const [a, b] = range.split(/\s*(?:–|-|to)\s*/);
    const start = a ? toMinutes(a) : null;
    let end = b ? toMinutes(b) : null;
    if (start === null || end === null) continue;
    if (end <= start) end += 1440; // past midnight
    out.push({ start, end });
  }
  return out.sort((x, y) => x.start - y.start);
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// A day's opening hours: a special day (a bank holiday) if set, else the weekday's usual hours.
export function openingFor(
  date: string,
  weekday: number,
  hours: Record<string, string> | null | undefined,
  special: Record<string, { hours: string }> | null | undefined,
): Span[] {
  const sp = special?.[date]?.hours;
  return openSpans(sp ?? hours?.[DAY_NAMES[weekday - 1]] ?? null);
}

// Availability as minutes: an end at or before the start runs past midnight; "23:59" means the end of the day.
export function availabilitySpan(t: TimeSpan): Span {
  const start = toMinutes(t.starts) ?? 0;
  let end = t.ends === "23:59" ? 1440 : (toMinutes(t.ends) ?? 1440);
  if (end <= start) end += 1440;
  return { start, end };
}

export const ALL_DAY: TimeSpan = { starts: "00:00", ends: "23:59" };

// "17:00" / "17:30" / "00:30" for minutes after midnight (wrapping past midnight).
export function clockText(minutes: number) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// What owners and staff read: 720 -> "12pm", 1050 -> "5:30pm", 1440 -> "12am", 690 -> "11:30am".
export function time12(minutes: number) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${min ? `:${String(min).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

export const span12 = (start: number, end: number) => `${time12(start)}–${time12(end)}`;

// "12–22", "17:30–23", "20–24" (until midnight), "18–1" (past midnight): compact 24-hour, for logs.
export function shortSpan(start: number, end: number) {
  const t = (m: number) => {
    const w = ((m % 1440) + 1440) % 1440;
    return w % 60 ? `${Math.floor(w / 60)}:${String(w % 60).padStart(2, "0")}` : String(Math.floor(w / 60));
  };
  return `${t(start)}–${end > start && end % 1440 === 0 ? "24" : t(end)}`;
}
