// Suggested staffing for a restaurant's size (owner's plan, 12 Nov 2026): from the
// seat count asked in setup (restaurants.seats) and how it serves
// (restaurants.venue_types), the fewest of each role on shift whenever open and
// one more per so many orders an hour, for the roles the team actually has.
// Starting points for the owner to change, never pushed onto roles nobody fills.
// The head chef counts as a chef (one row), so a rota never runs short on the
// head chef's days off. No imports beyond ./rules and ./types: unit-tested
// (tests/rota-presets.test.ts).
import { canDo, roleKey, roleLabel, type Driver } from "./rules";
import type { RotaRule, RotaStaff } from "./types";

export const SEAT_BANDS = ["under_30", "30_60", "60_100", "over_100", "none"] as const;
export type SeatBand = (typeof SEAT_BANDS)[number];

export const SEAT_WORDS: Record<SeatBand, string> = {
  under_30: "under 30 seats",
  "30_60": "30 to 60 seats",
  "60_100": "60 to 100 seats",
  over_100: "over 100 seats",
  none: "no seating",
};

// One cell of the table: at least `min` whenever open, one more per `per` orders an hour (null: never more).
type Cell = { min: number; per: number | null };
type Row = Partial<Record<SeatBand, Cell>>;

// The table (agreed with the owner, 12 Nov 2026). A role missing from a band isn't suggested there.
export const PRESET_TABLE: Record<string, Row> = {
  manager: {
    under_30: { min: 0, per: null },
    "30_60": { min: 1, per: null },
    "60_100": { min: 1, per: null },
    over_100: { min: 1, per: null },
    none: { min: 0, per: null },
  },
  chef: {
    under_30: { min: 1, per: 15 },
    "30_60": { min: 2, per: 15 },
    "60_100": { min: 3, per: 15 },
    over_100: { min: 4, per: 15 },
    none: { min: 1, per: 15 },
  },
  kitchen_porter: {
    under_30: { min: 0, per: 20 },
    "30_60": { min: 1, per: null },
    "60_100": { min: 1, per: 40 },
    over_100: { min: 2, per: null },
    none: { min: 0, per: 25 },
  },
  server: {
    under_30: { min: 1, per: 10 },
    "30_60": { min: 1, per: 8 },
    "60_100": { min: 2, per: 8 },
    over_100: { min: 3, per: 8 },
  },
  host: {
    under_30: { min: 0, per: null },
    "30_60": { min: 0, per: null },
    "60_100": { min: 0, per: 15 },
    over_100: { min: 1, per: null },
  },
  bar: {
    under_30: { min: 0, per: null },
    "30_60": { min: 0, per: null },
    "60_100": { min: 1, per: null },
    over_100: { min: 1, per: null },
  },
  runner: {
    under_30: { min: 0, per: null },
    "30_60": { min: 0, per: null },
    "60_100": { min: 0, per: 12 },
    over_100: { min: 1, per: 12 },
  },
  counter: {
    under_30: { min: 0, per: null },
    "30_60": { min: 0, per: 15 },
    "60_100": { min: 1, per: null },
    over_100: { min: 1, per: null },
    none: { min: 1, per: 20 },
  },
  driver: {
    under_30: { min: 0, per: 4 },
    "30_60": { min: 0, per: 4 },
    "60_100": { min: 0, per: 4 },
    over_100: { min: 0, per: 4 },
    none: { min: 0, per: 4 },
  },
};

// Which orders make each role busier, and its time before opening and after closing.
export const ROLE_SHAPE: Record<string, { driver: Driver; before: number; after: number }> = {
  manager: { driver: "none", before: 30, after: 30 },
  chef: { driver: "all", before: 30, after: 0 },
  kitchen_porter: { driver: "all", before: 0, after: 30 },
  server: { driver: "eat_in", before: 15, after: 15 },
  host: { driver: "eat_in", before: 0, after: 0 },
  bar: { driver: "eat_in", before: 15, after: 15 },
  runner: { driver: "eat_in", before: 0, after: 0 },
  counter: { driver: "takeaway", before: 15, after: 15 },
  driver: { driver: "delivery", before: 0, after: 0 },
  kitchen: { driver: "all", before: 30, after: 0 },
  front: { driver: "eat_in", before: 15, after: 15 },
};

// The band to use: no eating in means no seating, whatever the seat answer said;
// seats not given: 30 to 60 if they eat in.
export function bandFor(seats: string | null | undefined, venueTypes: string[] | null | undefined): SeatBand {
  const v = new Set(venueTypes ?? []);
  if (v.size && !v.has("dine_in")) return "none";
  if (seats && (SEAT_BANDS as readonly string[]).includes(seats)) return seats as SeatBand;
  return v.size && !v.has("dine_in") ? "none" : "30_60";
}

// The roles a team has, as the rota counts them (a head chef is a chef).
export function teamRoles(staff: Pick<RotaStaff, "roles">[]): Set<string> {
  const out = new Set<string>();
  for (const p of staff) {
    const main = roleKey(p.roles[0] ?? "");
    if (!main) continue;
    out.add(main === "head_chef" ? "chef" : main);
  }
  // An all-round person next to people with the specific job fills that job's
  // rule (rules.canDo), so the all-round rule would count them twice.
  if (out.has("chef")) out.delete("kitchen");
  if (["server", "counter"].some((r) => out.has(r))) out.delete("front");
  return out;
}

export type Suggestion = { band: SeatBand; rules: RotaRule[]; notes: string[] };

const cellFor = (role: string, band: SeatBand): Cell | null => {
  // All-round roles take the numbers of their main job.
  const source = role === "kitchen" ? "chef" : role === "front" ? (band === "none" ? "counter" : "server") : role;
  return PRESET_TABLE[source]?.[band] ?? null;
};

// The suggested rules for a team: one per role it has, with notes on roles it seems to be missing.
export function suggestedRules(input: { seats: string | null | undefined; venueTypes: string[] | null | undefined; staff: Pick<RotaStaff, "roles">[] }): Suggestion {
  const band = bandFor(input.seats, input.venueTypes);
  const v = new Set(input.venueTypes ?? []);
  const roles = teamRoles(input.staff);
  const rules: RotaRule[] = [];
  for (const role of roles) {
    const cell = cellFor(role, band);
    const shape = ROLE_SHAPE[role];
    // A role of the owner's own, or one we don't suggest for this size: kept, with no minimum.
    if (!cell || !shape) {
      rules.push({
        role,
        min_on_shift: 0,
        orders_per_extra_staff: null,
        driver: "none",
        before_open_minutes: 0,
        after_close_minutes: 0,
        preset: `seats:${band}`,
      });
      continue;
    }
    // Counter staff where nobody takes away: the minimum only.
    const driver = role === "counter" && v.size && !v.has("takeaway") ? "none" : shape.driver;
    rules.push({
      role,
      min_on_shift: cell.min,
      orders_per_extra_staff: driver === "none" ? null : cell.per,
      driver,
      before_open_minutes: shape.before,
      after_close_minutes: shape.after,
      preset: `seats:${band}`,
    });
  }
  return {
    band,
    rules: sortRules(rules),
    notes: missingRoleNotes({ band, roles, venueTypes: v, staff: input.staff }),
  };
}

const ORDER = ["manager", "chef", "kitchen", "kitchen_porter", "server", "front", "host", "bar", "runner", "counter", "driver"];
export const sortRules = (rules: RotaRule[]) => [...rules].sort((a, b) => (ORDER.indexOf(a.role) + 1 || 99) - (ORDER.indexOf(b.role) + 1 || 99) || a.role.localeCompare(b.role));

// "You have no kitchen porter. Who washes up: the chefs, or shall I add a porter?"
export function missingRoleNotes(input: { band: SeatBand; roles: Set<string>; venueTypes: Set<string>; staff: Pick<RotaStaff, "roles">[] }): string[] {
  const notes: string[] = [];
  const anyone = (role: string) => input.staff.some((p) => canDo(p.roles, role) !== null);
  const cooks = anyone("chef") || anyone("kitchen");
  if (!cooks) notes.push("Nobody on your team cooks yet: add your chefs so the rota covers the kitchen.");
  if (cooks && input.band !== "under_30" && input.band !== "none" && !anyone("kitchen_porter"))
    notes.push("You have no kitchen porter. If the chefs wash up, that's fine; otherwise add a porter so the rota includes one.");
  if (input.venueTypes.has("dine_in") && input.band !== "none" && !anyone("server") && !anyone("front"))
    notes.push("Nobody on your team serves tables. Add your servers so the rota covers the floor.");
  if ((input.band === "60_100" || input.band === "over_100") && !anyone("manager"))
    notes.push(`For ${SEAT_WORDS[input.band]}, most places have a manager or supervisor on every shift. Add one if someone does that job.`);
  if (input.venueTypes.has("delivery") && !anyone("driver")) notes.push("No drivers on the team, so I'll take it that delivery apps bring your deliveries. Add your drivers if you have your own.");
  return notes;
}

// The rules as the owner reads them, one line per role.
export function ruleLine(rule: Pick<RotaRule, "role" | "min_on_shift" | "orders_per_extra_staff" | "driver">) {
  const words: Record<string, string> = {
    all: "orders",
    eat_in: "eat-in orders",
    takeaway: "takeaway orders",
    delivery: "delivery orders",
    none: "",
  };
  const name = roleLabel(rule.role);
  const per = rule.orders_per_extra_staff;
  const what = words[rule.driver ?? "all"] || "orders";
  if (!per) return `${name}: ${rule.min_on_shift ? `${rule.min_on_shift} whenever open` : "only when you put them on"}`;
  return rule.min_on_shift ? `${name}: ${rule.min_on_shift}, plus 1 per ${per} ${what} an hour` : `${name}: 1 per ${per} ${what} an hour when busy`;
}
