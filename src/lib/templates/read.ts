// Reading our own spreadsheets back once the owner has filled them in: plain code,
// no AI, because we know exactly what each column is. A file whose headings don't
// match (an old copy, or someone else's sheet) comes back as a problem, never a
// guess. Unit-tested (tests/templates.test.ts).
import type { CostInput } from "@/lib/menu-engineering";
import { STAFF_ROLES, type StaffInputRow, type StaffRole } from "@/lib/onboarding/dina/ops-content";
import { parseDate, parseMoney, type Cell, type Table } from "@/lib/sales/pos-table";
import { ALL_OTHER_DISHES, DAILY_TAKINGS_MAPPING, EXACTNESS, EXAMPLE_MARK, MENU_COLUMNS, STAFF_COLUMNS, TAKINGS_COLUMNS } from "./specs";

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const text = (c: Cell | undefined) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? "").replace(/\s+/g, " ").trim());

// Column positions by heading; missing ones are listed.
function columns<K extends string>(table: Table, want: Record<K, string>, required: NoInfer<K>[]) {
  const at = {} as Record<K, number>;
  for (const [k, h] of Object.entries(want) as [K, string][]) at[k] = table.headers.findIndex((x) => norm(x) === norm(h));
  const missing = required.filter((k) => at[k] < 0).map((k) => want[k]);
  return { at, missing };
}

const number = (c: Cell | undefined): number | null => {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  const m = text(c).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// ---------- Menu and costs ----------

export type MenuCostsRead = { costs: CostInput[]; rest_percent: number | null; top: string[]; slow: string[]; problems: string[] };

// (No table at all: a sheet with nothing filled in can read as empty.)
export function readMenuCosts(table: Table | null): MenuCostsRead {
  const out: MenuCostsRead = { costs: [], rest_percent: null, top: [], slow: [], problems: [] };
  if (!table) return { ...out, problems: ["nothing was filled in yet"] };
  const { at, missing } = columns(table, MENU_COLUMNS, ["dish", "cost"]);
  if (missing.length) return { ...out, problems: [`this isn't the menu costs sheet (no ${missing.join(" or ")} column)`] };
  for (const row of table.rows) {
    const dish = text(row[at.dish]);
    if (!dish) continue;
    const costCell = row[at.cost];
    const cost = typeof costCell === "number" ? String(costCell) : text(costCell);
    if (norm(dish) === norm(ALL_OTHER_DISHES)) {
      if (!cost) continue;
      const n = number(costCell);
      // "30%", "30", or Excel's own 0.3 for a cell it turned into a percentage.
      const pct = n === null ? null : n > 0 && n < 1 && !/%/.test(cost) ? n * 100 : n;
      if (pct !== null && pct > 0 && pct < 100) out.rest_percent = Math.round(pct * 10) / 10;
      else out.problems.push(`the "${ALL_OTHER_DISHES}" row should be a share of the price, like 30%`);
      continue;
    }
    if (cost) out.costs.push({ dish, cost, estimated: at.exact < 0 || norm(row[at.exact]) !== norm(EXACTNESS.exact) });
  }
  if (!out.costs.length && out.rest_percent === null) out.problems.push("nothing was filled in yet");
  return out;
}

// ---------- Staff ----------

const ROLE_WORDS: [RegExp, StaffRole][] = [
  [/manager|supervisor|gm\b/, "manager"],
  [/kitchen|chef|cook|kp|porter|grill|tandoor/, "kitchen"],
  [/front|foh|wait|server|floor|bar|counter|cashier|host/, "front"],
  [/deliver|driver|rider/, "delivery"],
];
export function roleFrom(c: Cell | undefined): StaffRole | null {
  const v = norm(c);
  if ((STAFF_ROLES as readonly string[]).includes(v)) return v as StaffRole;
  return ROLE_WORDS.find(([re]) => re.test(v))?.[1] ?? null;
}

export type StaffRead = { staff: StaffInputRow[]; problems: string[] };

export function readStaff(table: Table | null): StaffRead {
  const out: StaffRead = { staff: [], problems: [] };
  if (!table) return { ...out, problems: ["nobody was filled in yet (the grey example rows are ignored)"] };
  const { at, missing } = columns(table, STAFF_COLUMNS, ["name", "role"]);
  if (missing.length) return { ...out, problems: [`this isn't the team sheet (no ${missing.join(" or ")} column)`] };
  const opt = (row: Cell[], i: number) => (i < 0 ? null : text(row[i]) || null);
  const num = (row: Cell[], i: number) => (i < 0 ? null : number(row[i]));
  for (const row of table.rows) {
    const name = text(row[at.name]);
    if (!name || name.toLowerCase().includes(EXAMPLE_MARK)) continue;
    const role = roleFrom(row[at.role]);
    if (!role) {
      out.problems.push(`${name}'s role ("${text(row[at.role]) || "blank"}") isn't Kitchen, Front of house, Delivery or Manager`);
      continue;
    }
    out.staff.push({ name, role, hourly_rate: num(row, at.rate), contracted_hours: num(row, at.contracted), days: opt(row, at.days), times: opt(row, at.times), max_hours: num(row, at.max) });
  }
  if (!out.staff.length && !out.problems.length) out.problems.push("nobody was filled in yet (the grey example rows are ignored)");
  return out;
}

// ---------- Daily takings ----------

export type TakingsDay = { day: string; takings: number; orders: number | null };
export type TakingsRead = { days: TakingsDay[]; problems: string[] };

// One row per day: blank takings means closed or not known (left out); orders are optional.
export function readDailyTakings(table: Table | null): TakingsRead {
  const out: TakingsRead = { days: [], problems: [] };
  if (!table) return { ...out, problems: ["no takings were filled in yet"] };
  const { at, missing } = columns(table, TAKINGS_COLUMNS, ["date", "takings"]);
  if (missing.length) return { ...out, problems: [`this isn't the daily takings sheet (no ${missing.join(" or ")} column)`] };
  const seen = new Set<string>();
  for (const row of table.rows) {
    const takingsCell = row[at.takings];
    if (takingsCell === null || takingsCell === undefined || text(takingsCell) === "") continue;
    const date = parseDate(row[at.date] ?? null, DAILY_TAKINGS_MAPPING.date_order);
    const takings = parseMoney(takingsCell);
    if (!date) {
      out.problems.push(`a row with takings of ${text(takingsCell)} has no date I can read`);
      continue;
    }
    if (takings === null || takings < 0) {
      out.problems.push(`the takings on ${date.day} ("${text(takingsCell)}") aren't an amount`);
      continue;
    }
    if (seen.has(date.day)) {
      out.problems.push(`${date.day} is in the sheet twice`);
      continue;
    }
    seen.add(date.day);
    const orders = at.orders < 0 ? null : number(row[at.orders]);
    out.days.push({ day: date.day, takings: Math.round(takings * 100) / 100, orders: orders !== null && orders > 0 ? Math.round(orders) : null });
  }
  if (!out.days.length && !out.problems.length) out.problems.push("no takings were filled in yet");
  out.days.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}
