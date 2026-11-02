// The Pilot Zero simulation (docs/pilot-zero.md, phase 3): the rules, as plain
// code with no imports so they're unit-tested (tests/simulation.test.ts).
// lib/simulation.ts carries them out.
//
// A Pilot Zero restaurant's simulation is on while it has a simulated clock
// (restaurants.fake_now, set only from the admin console). While it's on:
//   - the owner's own messages run on the simulated clock (restaurantNow);
//   - the real scheduled jobs skip the restaurant (lib/queue/dispatch.ts) and
//     "Run day" runs them for the simulated date instead, in the real order;
//   - everything injected (till reports, quiet days, reviews) is stored with
//     simulated = true (and is_dummy for sales), so it can be filtered out or
//     cleared, and briefs and reports made meanwhile say they're simulated.

export type SimRestaurant = { pilot_zero?: boolean | null; fake_now?: string | null };

export const simulationOn = (r: SimRestaurant | null | undefined) => Boolean(r?.pilot_zero === true && r.fake_now);

// The simulated date ("2026-11-04"), or null.
export function simulatedDay(r: SimRestaurant, londonYmd: (d: Date) => string) {
  return simulationOn(r) ? londonYmd(new Date(r.fake_now!)) : null;
}

export type DayStep = { step: "reviews" | "forecast" | "morning" | "rota"; morning?: string; hour: number; minute: number; label: string };

const MORNING_LABELS: Record<string, string> = {
  release: "Held sends released",
  birthday: "Monday birthday email",
  post: "Google post",
  report: "Monday report",
  monday: "Monday planning",
  brief: "Morning brief",
};

// Run day: the scheduled jobs for one simulated date, in the order the real ones
// run in a day (lib/queue/rules.ts): the hourly review check overnight (so a
// review that came in is drafted and held for the brief, or alerted at once if
// it's 1 to 3 stars), the nightly forecast at 05:35, the morning job's steps at
// the brief hour (held sends, Monday's birthday email, Monday and Thursday's
// Google post, Monday's report, then the brief), and Thursday's rota at 10:00.
// Each step is its own queued job, like the real morning job's.
// weekday: 1 = Monday ... 7 = Sunday; morningSteps: lib/queue/rules.ts morningStepsFor.
export function runDaySteps(weekday: number, briefHour: number, morningSteps: readonly string[]): DayStep[] {
  const steps: DayStep[] = [
    { step: "reviews", hour: 2, minute: 5, label: "Review check" },
    { step: "forecast", hour: 5, minute: 35, label: "Nightly forecast" },
    ...morningSteps.map((m) => ({ step: "morning" as const, morning: m, hour: briefHour, minute: 0, label: MORNING_LABELS[m] ?? m })),
  ];
  if (weekday === 4) steps.push({ step: "rota", hour: 10, minute: 0, label: "Thursday rota" });
  // An 11am brief comes after Thursday's 10am rota, as it really would (the sort keeps the morning steps in order).
  return steps.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

// After Run day the clock rests at midday on the simulated date, inside sending
// hours, so the owner can answer the brief and approve things.
export const REST_HOUR = 12;

// ---------- Till reports ----------

// A believable till report for the day: the restaurant's usual takings for that
// weekday (the average of the same weekday in its sales history), or a typical
// day for a small restaurant if it has none. A quiet day is about 45% of usual.
export const DEFAULT_TAKINGS: Record<number, number> = { 1: 950, 2: 900, 3: 1000, 4: 1150, 5: 1700, 6: 1950, 7: 1400 };
export const QUIET_SHARE = 0.45;

export function usualTakings(history: { day: string; net_sales: number }[], weekday: number, weekdayOf: (ymd: string) => number) {
  const same = history.filter((d) => weekdayOf(d.day) === weekday && Number(d.net_sales) > 0);
  if (!same.length) return DEFAULT_TAKINGS[weekday] ?? 1000;
  return Math.round(same.reduce((s, d) => s + Number(d.net_sales), 0) / same.length);
}

// The hours a typical day's takings fall in (lunch and dinner), as shares.
const HOUR_SHARES: [number, number][] = [
  [12, 0.08],
  [13, 0.12],
  [14, 0.06],
  [15, 0.03],
  [16, 0.04],
  [17, 0.09],
  [18, 0.15],
  [19, 0.18],
  [20, 0.15],
  [21, 0.1],
];

export function simulatedZ(input: { net: number; quiet: boolean }) {
  const net = Math.round(input.net * (input.quiet ? QUIET_SHARE : 1) * 100) / 100;
  const gross = Math.round(net * 1.2 * 100) / 100;
  const vat = Math.round((gross - net) * 100) / 100;
  const transactions = Math.max(1, Math.round(gross / 24));
  const card = Math.round(gross * 0.85 * 100) / 100;
  const hourly = HOUR_SHARES.map(([hour, share]) => ({ hour, sales: Math.round(gross * share * 100) / 100 }));
  return { net_sales: net, gross_sales: gross, vat, transactions, card, cash: Math.round((gross - card) * 100) / 100, hourly };
}

// ---------- Reviews ----------

const REVIEWS: Record<number, { author: string; text: string }[]> = {
  5: [
    { author: "Sim: Amira K.", text: "Lovely food and quick service. The lamb biryani was the best I've had in Ilford. Will be back with the family." },
    { author: "Sim: Daniel O.", text: "Great portions, friendly staff, spotless tables. Five stars." },
  ],
  4: [{ author: "Sim: Priya S.", text: "Really tasty mixed grill. Bit of a wait on Saturday night but worth it." }],
  3: [{ author: "Sim: Tom R.", text: "Food was fine but it took 40 minutes and nobody told us why." }],
  2: [{ author: "Sim: Hassan M.", text: "Chips were cold and the order was missing a drink. Staff were apologetic though." }],
  1: [{ author: "Sim: Laura B.", text: "Waited over an hour for a takeaway, food arrived cold and the manager was rude when I complained. Won't be back." }],
};

// The n-th simulated review of this rating (cycling through the canned ones).
export function simulatedReview(rating: number, n = 0) {
  const r = Math.min(5, Math.max(1, Math.round(rating)));
  const list = REVIEWS[r];
  return { rating: r, ...list[n % list.length] };
}

// The line at the top of a brief or report made while the simulation is on.
export const simulatedLabel = (longDate: string) => `🧪 Simulated day: ${longDate}. Figures and reviews here may be simulated.`;

// What the restaurant row keeps while a simulation is on (restaurants.simulation):
// when it started, and the once-a-day markers Stop puts back.
export type SimulationState = { started_at: string; markers: Record<string, unknown> };
