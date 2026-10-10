// Money and date wording for sales. No imports, so it's unit-tested and pages can use it.

// "£2,340" (whole pounds) or "£2,340.50" (with pence).
export function gbp(n: number, pence = false) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}£${abs.toLocaleString("en-GB", { minimumFractionDigits: pence ? 2 : 0, maximumFractionDigits: pence ? 2 : 0 })}`;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// "2026-10-09" -> "Thu 9 Oct" (the year only if it isn't `currentYear`).
export function dayLabel(ymd: string, currentYear?: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const opts: Intl.DateTimeFormatOptions = { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" };
  if (currentYear !== undefined && y !== currentYear) opts.year = "numeric";
  return date.toLocaleDateString("en-GB", opts).replace(",", "");
}

// Whole days between two "YYYY-MM-DD" dates (b - a).
export function daysBetween(a: string, b: string) {
  const t = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

// "2026-10-09" plus n days.
export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

// 0 = Sunday ... 6 = Saturday, for a "YYYY-MM-DD" date.
export function weekdayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
