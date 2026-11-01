import { offerProblems } from "./facts-content";

// Steps 7 to 12 in plain code (unit-tested in tests/dina-ops.test.ts): how much
// sales history arrived, the tips for exporting it from a till, what the team,
// rewards and timing answers may be, and the safe defaults when a step is skipped.

// ---------- 7. Sales history ----------

// Forecasts need at least this much history (step 35: they refuse under 8 weeks).
export const MIN_SALES_WEEKS = 8;

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ymd: string) => `${MONTH[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;

// "11 months of sales, Nov 2025 to Oct 2026" from the first and last day imported
// (UK dates, YYYY-MM-DD). Enough for forecasts from MIN_SALES_WEEKS weeks.
export function salesCoverage(firstDay: string, lastDay: string) {
  const days = Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000) + 1;
  const weeks = Math.floor(days / 7);
  const months = Math.round(days / 30.44);
  const length = months >= 2 ? `${months} months` : weeks >= 2 ? `${weeks} weeks` : `${days} day${days === 1 ? "" : "s"}`;
  const span = monthLabel(firstDay) === monthLabel(lastDay) ? monthLabel(firstDay) : `${monthLabel(firstDay)} to ${monthLabel(lastDay)}`;
  return { days, weeks, enough: weeks >= MIN_SALES_WEEKS, text: `${length} of sales, ${span}` };
}

export const SALES_GAP_LINE = `Send me at least ${MIN_SALES_WEEKS} weeks of sales and I'll forecast quiet nights and plan offers before they happen.`;

// How to export a year of sales from the common UK tills, for Dina to pass on.
// PLACEHOLDERS: replace each with the real click path (keep them short, one line each).
export const POS_TIPS: Record<string, string> = {
  Square: "PLACEHOLDER: in Square Dashboard, Reports, Item sales, pick the last 12 months, then Export as CSV.",
  Lightspeed: "PLACEHOLDER: in Lightspeed Back Office, Reports, Sales, pick the last 12 months, then Export as CSV or Excel.",
  "Epos Now": "PLACEHOLDER: in Epos Now Back Office, Reporting, Sales by product, pick the last 12 months, then Export.",
};

// ---------- 8. Team and labour ----------

export const STAFF_ROLES = ["kitchen", "front", "delivery", "manager"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const ROLE_WORDS: Record<StaffRole, string> = { kitchen: "kitchen", front: "front of house", delivery: "delivery", manager: "manager" };

export const DEFAULT_LABOUR_TARGET = 30;
export const LABOUR_HINT = "Most UK independents aim for 25 to 35% of sales; 30% is a common target.";

export type StaffInputRow = { name: string; role: StaffRole; hourly_rate: number | null; contracted_hours: number | null };
export type CoverRule = { role: StaffRole; min_on_shift: number };

// What's wrong with the team as given, in words for Dina to ask about (empty: fine).
// The UK minimum wage is checked loosely: a rate under £5 or over £60 an hour is
// probably a typo (a weekly or monthly figure), so she asks.
export function teamProblems(input: { staff: StaffInputRow[]; manager: string | null; cover_rules: CoverRule[]; labour_target_pct: number | null }) {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const s of input.staff) {
    const key = s.name.trim().toLowerCase();
    if (names.has(key)) problems.push(`${s.name} is on the list twice.`);
    names.add(key);
    if (s.hourly_rate !== null && (s.hourly_rate < 5 || s.hourly_rate > 60)) problems.push(`${s.name}'s rate of £${s.hourly_rate} an hour looks wrong (is it weekly or monthly?).`);
    if (s.contracted_hours !== null && (s.contracted_hours < 0 || s.contracted_hours > 60)) problems.push(`${s.name}'s ${s.contracted_hours} contracted hours a week looks wrong.`);
  }
  if (input.manager && input.staff.length && !names.has(input.manager.trim().toLowerCase()) && !/\b(me|myself|i do|owner)\b/i.test(input.manager))
    problems.push(`The site manager, ${input.manager}, isn't on the staff list. Add them, or check the name.`);
  for (const r of input.cover_rules) if (r.min_on_shift < 1 || r.min_on_shift > 20) problems.push(`At least ${r.min_on_shift} ${ROLE_WORDS[r.role]} on shift doesn't look right.`);
  if (input.labour_target_pct !== null && (input.labour_target_pct < 10 || input.labour_target_pct > 60)) problems.push(`A labour target of ${input.labour_target_pct}% is unusual. ${LABOUR_HINT} Check the number with them.`);
  return problems;
}

// ---------- 9. Rewards and the discount cap ----------

export const DEFAULT_SIGNUP_REWARD = "a free dessert";
export const MIN_CAP = 5;
export const MAX_CAP = 50;

// A new sign-up reward and cap: the reward must fit the cap, and so must every
// "making it right" offer already saved (they're checked against the cap too).
export function rewardsProblems(input: { signup_reward: string; discount_cap_percent: number }, recoveryOffers: string[]) {
  const problems: string[] = [];
  const cap = input.discount_cap_percent;
  if (!Number.isInteger(cap) || cap < MIN_CAP || cap > MAX_CAP) problems.push(`The discount cap has to be a whole number from ${MIN_CAP} to ${MAX_CAP}%.`);
  else {
    problems.push(...offerProblems([input.signup_reward], cap).map((p) => `The sign-up reward: ${p}`));
    const over = offerProblems(recoveryOffers, cap);
    if (over.length) problems.push(`Their saved offers for unhappy customers wouldn't fit a ${cap}% cap: ${over.join(" ")} Ask whether to keep a higher cap, or change those offers first.`);
  }
  return problems;
}

// ---------- 12. Approvals and timing ----------

export const BRIEF_HOURS = [7, 8, 9, 10, 11] as const;
export const DEFAULT_TIMING = { brief_hour: 9, quiet_start: "09:00", quiet_end: "21:00" } as const;

const toMinutes = (t: string) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const hhmm = (t: string) => {
  const m = toMinutes(t);
  return m === null ? null : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// Messages to customers go out between quiet_start and quiet_end (the send window).
// Not before 7am or after 10pm (PECR and good manners), and at least 4 hours long.
export function timingProblems(input: { brief_hour: number; quiet_start: string; quiet_end: string }) {
  const problems: string[] = [];
  if (!(BRIEF_HOURS as readonly number[]).includes(input.brief_hour)) problems.push("The morning brief can come at 7, 8, 9, 10 or 11am (whole hours).");
  const start = toMinutes(input.quiet_start);
  const end = toMinutes(input.quiet_end);
  if (start === null || end === null) problems.push("The sending hours need to be times like 09:00 and 21:00.");
  else {
    if (start < 7 * 60) problems.push("Customer messages can't go out before 7am.");
    if (end > 22 * 60) problems.push("Customer messages can't go out after 10pm.");
    if (end - start < 4 * 60) problems.push("The sending hours need to be at least 4 hours long, starting before they end.");
  }
  return problems;
}

export const hourWords = (h: number) => (h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`);
