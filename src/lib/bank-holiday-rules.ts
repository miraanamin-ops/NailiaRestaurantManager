// Which bank holidays to ask the owner about, and how. No imports, so it's
// unit-tested (tests/bank-holidays.test.ts).

export type BankHoliday = { date: string; title: string }; // date: YYYY-MM-DD
export type HolidayFlag = BankHoliday & { days: number };

export const LOOKAHEAD_DAYS = 28;

const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T12:00:00Z`) / 86_400_000);

// Bank holidays from today up to 4 weeks ahead that have no special hours set
// (special_hours is keyed by date; "usual" counts as set: the owner answered).
export function holidaysAhead(holidays: BankHoliday[], specialHours: Record<string, unknown> | null, today: string, lookahead = LOOKAHEAD_DAYS): HolidayFlag[] {
  const from = dayNumber(today);
  return holidays
    .map((h) => ({ ...h, days: dayNumber(h.date) - from }))
    .filter((h) => h.days >= 0 && h.days <= lookahead && !(specialHours && h.date in specialHours))
    .sort((a, b) => a.days - b.days);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function longDate(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function whenText(days: number) {
  if (days === 0) return "is today";
  if (days === 1) return "is tomorrow";
  if (days < 7) return `is in ${days} days`;
  const weeks = Math.round(days / 7);
  return `is in ${weeks} week${weeks === 1 ? "" : "s"}`;
}

// "Christmas Day (Friday 25 December) is in 3 weeks. Are your hours changing?"
export function holidayQuestion(flag: HolidayFlag, usualHours: string | null) {
  return `📅 *${flag.title}* (${longDate(flag.date)}) ${whenText(flag.days)}. Are your hours changing?${usualHours ? `\n\nYour usual ${WEEKDAYS[new Date(`${flag.date}T12:00:00Z`).getUTCDay()]} hours: ${usualHours}` : ""}`;
}

export function usualHoursOn(openingHours: Record<string, string> | null, ymd: string) {
  return openingHours?.[WEEKDAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()]] ?? null;
}
