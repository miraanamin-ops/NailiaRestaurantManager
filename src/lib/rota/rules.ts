// The rota suggester's rules (docs/pilot-sprint.md, "Rota suggester"; roles and
// suggested staffing, owner's plan 12 Nov 2026): roles, per-restaurant settings
// with sensible defaults, opening hours as minutes, and how many people each role
// needs in each half hour.
// No imports beyond ./types, so it's unit-tested (tests/rota-rules.test.ts).
import type { RotaRule, RotaStaff, TimeSpan } from "./types";

// ---------- Roles ----------
// About ten everyday roles in three areas, plus the two all-round roles older
// teams use ("kitchen", "front"), which keep working exactly as before.
// "delivery" is now "driver". A person's first role is their main one; the rest
// are what they can also do.

export const ROLES = ["manager", "head_chef", "chef", "kitchen_porter", "server", "host", "bar", "runner", "counter", "driver", "kitchen", "front"] as const;
export type Role = (typeof ROLES)[number];

export type Area = "kitchen" | "front" | "delivery" | "management";
// What makes a role busier: all orders, eat-in orders, takeaway orders,
// delivery orders, or nothing (the same number whenever open).
export const DRIVERS = ["all", "eat_in", "takeaway", "delivery", "none"] as const;
export type Driver = (typeof DRIVERS)[number];

export type RoleDef = { label: string; area: Area; driver: Driver; hint: string };

export const ROLE_DEFS: Record<Role, RoleDef> = {
  manager: { label: "Manager", area: "management", driver: "none", hint: "manager or supervisor who runs the shift" },
  head_chef: { label: "Head chef", area: "kitchen", driver: "all", hint: "runs the kitchen and cooks; counts as a chef on the rota" },
  chef: { label: "Chef", area: "kitchen", driver: "all", hint: "chef, cook, sous chef, grill or tandoor" },
  kitchen_porter: { label: "Kitchen porter", area: "kitchen", driver: "all", hint: "washes up, cleans, helps with prep (KP, dishwasher)" },
  server: { label: "Server", area: "front", driver: "eat_in", hint: "waiter or waitress" },
  host: { label: "Host", area: "front", driver: "eat_in", hint: "greets and seats customers, takes bookings" },
  bar: { label: "Bar", area: "front", driver: "eat_in", hint: "drinks, bar or barista" },
  runner: { label: "Runner", area: "front", driver: "eat_in", hint: "takes food to tables and clears" },
  counter: { label: "Counter", area: "front", driver: "takeaway", hint: "takeaway counter, till or phone orders" },
  driver: { label: "Driver", area: "delivery", driver: "delivery", hint: "your own delivery drivers (not Deliveroo or Uber Eats riders)" },
  kitchen: { label: "Kitchen", area: "kitchen", driver: "all", hint: "anyone in the kitchen (all-round)" },
  front: { label: "Front of house", area: "front", driver: "eat_in", hint: "anyone front of house (all-round)" },
};

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r, ROLE_DEFS[r].label]));
export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
export const isKnownRole = (role: string): role is Role => (ROLES as readonly string[]).includes(role);
export const areaOf = (role: string): Area | null => (isKnownRole(role) ? ROLE_DEFS[role].area : null);
// The roles an owner picks from (the two all-round ones are for older teams).
export const PICK_ROLES: Role[] = ["manager", "head_chef", "chef", "kitchen_porter", "server", "host", "bar", "runner", "counter", "driver"];
// "manager, head chef, chef, ...": for prompts and help lines.
export const pickRoleWords = () => PICK_ROLES.map((r) => ROLE_DEFS[r].label.toLowerCase()).join(", ");

const ROLE_WORDS: [RegExp, Role][] = [
  [/^(manager|managers|gm|general manager|supervisor|supervisors|shift lead|shift leader|shift manager|assistant manager|duty manager|restaurant manager)$/, "manager"],
  [/^(head chef|head chefs|chef de cuisine|executive chef|kitchen manager|head cook)$/, "head_chef"],
  [/^(chef|chefs|cook|cooks|sous chef|sous chefs|line cook|line cooks|commis|commis chef|chef de partie|cdp|grill|grill chef|tandoor|tandoori chef|pizza chef|pizzaiolo|prep|prep cook|prep chef|curry chef|baker)$/, "chef"],
  [/^(kitchen porter|kitchen porters|kp|kps|porter|porters|dishwasher|dishwashers|pot wash|pot washer|washer up|washing up|kitchen assistant|kitchen hand)$/, "kitchen_porter"],
  [/^(server|servers|waiter|waiters|waitress|waitresses|waiting staff|wait staff|waiting|floor staff|floor)$/, "server"],
  [/^(host|hosts|hostess|greeter|maitre d|front desk|reception)$/, "host"],
  [/^(bar|bars|bartender|bartenders|barman|barmaid|bar staff|barista|baristas|drinks|mixologist)$/, "bar"],
  [/^(runner|runners|food runner|food runners|busser|bussers|bus boy|busboy|clearer)$/, "runner"],
  [/^(counter|counter staff|cashier|cashiers|till|tills|takeaway|takeaway counter|phone|phones|front counter|service counter)$/, "counter"],
  [/^(driver|drivers|delivery|deliveries|delivery driver|delivery drivers|rider|riders|courier|couriers)$/, "driver"],
  [/^(kitchen|kitchen staff|back of house|boh)$/, "kitchen"],
  [/^(front|foh|front of house|front of house staff)$/, "front"],
];

const clean = (word: string) =>
  word
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\(.*\)$/, "");

// "Chef" -> "chef", "KP" -> "kitchen_porter", "FOH" -> "front", "delivery" -> "driver";
// anything else stays as written (lower case): a role of the owner's own.
export function roleKey(word: string): string {
  const w = clean(word);
  const underscored = w.replace(/ /g, "_");
  if (isKnownRole(underscored)) return underscored;
  return ROLE_WORDS.find(([re]) => re.test(w))?.[1] ?? w;
}

export function isRoleWord(word: string) {
  const w = clean(word);
  return isKnownRole(w.replace(/ /g, "_")) || ROLE_WORDS.some(([re]) => re.test(w));
}

const KITCHEN_SPECIFIC = ["chef", "head_chef", "kitchen_porter"];
const FRONT_SPECIFIC = ["server", "host", "bar", "runner", "counter"];

// Can this person work this role? "main": it's their main role, or the same job
// by another name (a head chef cooks as a chef; a chef fills an all-round kitchen
// rule). "also": they can cover it (listed after their main role, or an all-round
// person covering a specific role of their area). null: not their job.
export function canDo(roles: string[], role: string): "main" | "also" | null {
  const keys = roles.map(roleKey);
  if (!keys.length) return null;
  const [main, ...rest] = keys;
  if (main === role) return "main";
  // Older teams list all-round roles side by side ("front, kitchen"): each is a main one.
  if ((role === "kitchen" || role === "front") && keys.includes(role)) return "main";
  if (role === "chef" && main === "head_chef") return "main";
  if (role === "kitchen" && (main === "chef" || main === "head_chef")) return "main";
  if (role === "front" && FRONT_SPECIFIC.includes(main)) return "main";
  if (rest.includes(role)) return "also";
  if (role === "chef" && rest.includes("head_chef")) return "also";
  if (keys.includes("kitchen") && KITCHEN_SPECIFIC.includes(role)) return "also";
  if (keys.includes("front") && FRONT_SPECIFIC.includes(role)) return "also";
  if (role === "kitchen" && keys.some((k) => KITCHEN_SPECIFIC.includes(k))) return "also";
  if (role === "front" && keys.some((k) => FRONT_SPECIFIC.includes(k))) return "also";
  return null;
}

// ---------- Settings ----------

export type RotaSettings = {
  min_shift_hours: number; // no shift shorter (unless the restaurant is open for less)
  max_shift_hours: number; // no shift longer
  flag_week_hours: number; // flag anyone over this many hours in the week (the 48-hour working time limit)
  flag_rest_hours: number; // flag anyone with less than this between two shifts (11 hours' daily rest)
  key_holder: boolean; // someone who can open and close on the first and last shift of each day (when anyone is marked as able to)
};

export const DEFAULT_SETTINGS: RotaSettings = { min_shift_hours: 4, max_shift_hours: 10, flag_week_hours: 48, flag_rest_hours: 11, key_holder: true };

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
    key_holder: typeof s.key_holder === "boolean" ? s.key_holder : DEFAULT_SETTINGS.key_holder,
  };
}

// ---------- Staffing rules ----------

// With no rule saved for a role someone has: these. The older roles (kitchen,
// front of house, driver, manager) keep exactly the numbers they always had,
// counting all orders. A restaurant whose seat count is known gets the
// suggestion for its size instead (./presets.ts).
export const DEFAULT_RULES: Record<Role, RotaRule> = {
  manager: { role: "manager", min_on_shift: 0, orders_per_extra_staff: null },
  head_chef: { role: "head_chef", min_on_shift: 0, orders_per_extra_staff: null, driver: "none" },
  chef: { role: "chef", min_on_shift: 1, orders_per_extra_staff: 15, driver: "all", before_open_minutes: 30 },
  kitchen_porter: { role: "kitchen_porter", min_on_shift: 0, orders_per_extra_staff: 20, driver: "all", after_close_minutes: 30 },
  server: { role: "server", min_on_shift: 1, orders_per_extra_staff: 8, driver: "eat_in", before_open_minutes: 15, after_close_minutes: 15 },
  host: { role: "host", min_on_shift: 0, orders_per_extra_staff: null, driver: "none" },
  bar: { role: "bar", min_on_shift: 0, orders_per_extra_staff: null, driver: "none" },
  runner: { role: "runner", min_on_shift: 0, orders_per_extra_staff: null, driver: "none" },
  counter: { role: "counter", min_on_shift: 0, orders_per_extra_staff: 20, driver: "takeaway" },
  driver: { role: "driver", min_on_shift: 0, orders_per_extra_staff: 10 },
  kitchen: { role: "kitchen", min_on_shift: 1, orders_per_extra_staff: 12 },
  front: { role: "front", min_on_shift: 1, orders_per_extra_staff: 15 },
};

// The roles that need a rule: each person's main role, plus any all-round or
// manager role they have (older teams list "front, kitchen" for someone who does both).
export function rolesOnTeam(staff: Pick<RotaStaff, "roles">[]) {
  const out = new Set<string>();
  for (const p of staff) {
    const keys = p.roles.map(roleKey);
    if (keys[0]) out.add(keys[0] === "head_chef" ? "chef" : keys[0]);
    for (const k of keys) if (k === "kitchen" || k === "front" || k === "manager") out.add(k);
  }
  return out;
}

// An all-round rule covers the specific roles of its area (so an older team's
// "kitchen" rule isn't joined by a "chef" default and counted twice).
const COVERED_BY: Record<string, string[]> = { kitchen: ["chef", "head_chef"], front: FRONT_SPECIFIC };

// The rules the fill uses: every saved rule, plus a default for any role someone
// on the team has but no rule covers (a role nobody has gets no default, so a
// restaurant without drivers isn't told it's short of drivers every day).
// defaults: the suggestion for this restaurant's size (./presets.ts), if it has one.
export function effectiveRules(saved: RotaRule[], staff: Pick<RotaStaff, "roles">[], defaults: RotaRule[] = []): RotaRule[] {
  const out = new Map<string, RotaRule>();
  for (const r of saved) out.set(roleKey(r.role), { ...r, role: roleKey(r.role) });
  const covered = new Set([...out.keys()].flatMap((k) => COVERED_BY[k] ?? []));
  // ...and a specific rule makes the all-round one unnecessary (its people fill it).
  if (out.has("chef") || out.has("head_chef")) covered.add("kitchen");
  if (FRONT_SPECIFIC.some((k) => out.has(k))) covered.add("front");
  for (const role of rolesOnTeam(staff)) {
    if (out.has(role) || covered.has(role)) continue;
    const d = defaults.find((x) => x.role === role) ?? (isKnownRole(role) ? DEFAULT_RULES[role] : { role, min_on_shift: 0, orders_per_extra_staff: null, driver: "none" as const });
    out.set(role, d);
  }
  return [...out.values()].sort((a, b) => order(a.role) - order(b.role));
}

const order = (role: string) => {
  const i = (ROLES as readonly string[]).indexOf(role);
  return i === -1 ? ROLES.length : i;
};

// Each channel's share of orders, from how the restaurant serves (restaurants.venue_types).
// null: not known, so every role counts all orders (as the rota always has).
export type ChannelShares = { eat_in: number; takeaway: number; delivery: number } | null;
export function channelShares(venueTypes: string[] | null | undefined): ChannelShares {
  const v = new Set((venueTypes ?? []).map((x) => x.toLowerCase()));
  const dine = v.has("dine_in");
  const take = v.has("takeaway");
  const del = v.has("delivery");
  if (!dine && !take && !del) return null;
  if (dine && take && del) return { eat_in: 0.5, takeaway: 0.25, delivery: 0.25 };
  if (dine && take) return { eat_in: 0.6, takeaway: 0.4, delivery: 0 };
  if (dine && del) return { eat_in: 0.65, takeaway: 0, delivery: 0.35 };
  if (take && del) return { eat_in: 0, takeaway: 0.5, delivery: 0.5 };
  return { eat_in: dine ? 1 : 0, takeaway: take ? 1 : 0, delivery: del ? 1 : 0 };
}

// The orders a rule counts in an hour: all of them, or its channel's share.
// A rule with no driver (every rule saved before 12 Nov 2026) counts all orders.
export function ordersFor(rule: Pick<RotaRule, "driver">, ordersInHour: number, shares: ChannelShares) {
  const d = rule.driver ?? "all";
  if (d === "none") return 0;
  if (d === "all" || !shares) return ordersInHour;
  return ordersInHour * shares[d];
}

// How many people a role needs in an hour with this many orders (already its channel's).
export function needFor(rule: RotaRule, ordersInHour: number) {
  const extra = rule.orders_per_extra_staff && ordersInHour > 0 ? Math.floor(ordersInHour / rule.orders_per_extra_staff) : 0;
  return rule.min_on_shift + extra;
}

// For the owner's words: "eat-in orders".
export const DRIVER_WORDS: Record<Driver, string> = { all: "orders", eat_in: "eat-in orders", takeaway: "takeaway orders", delivery: "delivery orders", none: "" };

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
