// What the rota is built from (docs/pilot-sprint.md): each person's roles, pay,
// weekly hours cap and availability by weekday, and the staffing rules per role.
// getRotaInputs (./inputs.ts) reads them from the 032 and 043 tables; in test
// mode a demo restaurant with no staff gets DUMMY_STAFF and DUMMY_RULES.
// No imports, so it's unit-tested (tests/pilot-contracts.test.ts).

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // Monday = 1
export type TimeSpan = { starts: string; ends: string }; // "HH:MM" London; an end at or before the start runs past midnight

export type RotaStaff = {
  id: string;
  name: string;
  roles: string[]; // "kitchen", "front"...
  hourly_rate_pence: number | null; // on the week's Monday; null = not set yet
  max_hours_week: number | null; // null = no cap beyond the working time rules
  availability: Record<Weekday, TimeSpan[]>; // when they can work (available or preferred)
};

export type RotaRule = {
  role: string;
  min_on_shift: number; // always at least this many
  orders_per_extra_staff: number | null; // one more person per this many forecast orders an hour
};

export type RotaInputs = {
  restaurantId: string;
  weekStart: string; // a Monday
  source: "tables" | "dummy";
  staff: RotaStaff[];
  rules: RotaRule[];
};

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export const noAvailability = (): Record<Weekday, TimeSpan[]> => ({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] });

// "17:00:00" -> "17:00"
export const hhmm = (time: string) => time.slice(0, 5);

// ---------- Dummy data (test mode only) ----------
// The same 8 people as the Test Kitchen seed (supabase/seed/test-kitchen.sql).

const every = (days: Weekday[], starts: string, ends: string) => {
  const a = noAvailability();
  for (const d of days) a[d] = [{ starts, ends }];
  return a;
};
const ALL = WEEKDAYS;
const WEEKEND: Weekday[] = [5, 6, 7];

export const DUMMY_STAFF: RotaStaff[] = [
  { id: "dummy-1", name: "Aisha (head chef)", roles: ["kitchen"], hourly_rate_pence: 1650, max_hours_week: 45, availability: every([2, 3, 4, 5, 6], "11:00", "23:00") },
  { id: "dummy-2", name: "Tomasz", roles: ["kitchen"], hourly_rate_pence: 1350, max_hours_week: 40, availability: every(ALL, "11:00", "23:00") },
  { id: "dummy-3", name: "Ravi", roles: ["kitchen"], hourly_rate_pence: 1250, max_hours_week: 30, availability: every([1, 2, 3, 4, 5], "16:00", "23:00") },
  { id: "dummy-4", name: "Leah", roles: ["kitchen"], hourly_rate_pence: 1221, max_hours_week: 20, availability: every(WEEKEND, "11:00", "23:00") },
  { id: "dummy-5", name: "Sam (manager)", roles: ["front"], hourly_rate_pence: 1500, max_hours_week: 45, availability: every([1, 2, 3, 4, 5, 6], "11:00", "23:00") },
  { id: "dummy-6", name: "Priya", roles: ["front"], hourly_rate_pence: 1250, max_hours_week: 35, availability: every(ALL, "11:30", "22:30") },
  { id: "dummy-7", name: "Jordan", roles: ["front"], hourly_rate_pence: 1221, max_hours_week: 16, availability: every([4, 5, 6], "17:00", "23:00") },
  { id: "dummy-8", name: "Mo", roles: ["front", "kitchen"], hourly_rate_pence: 1221, max_hours_week: 24, availability: every([1, 3, 5, 6, 7], "12:00", "22:00") },
];

export const DUMMY_RULES: RotaRule[] = [
  { role: "kitchen", min_on_shift: 2, orders_per_extra_staff: 12 },
  { role: "front", min_on_shift: 1, orders_per_extra_staff: 15 },
];
