// Prayer times: calculated per restaurant (the generator's method), and a
// mosque's timetable read from a CSV the builder uploads (it takes priority on
// the days it covers: analytics.prayer_times). Pure, unit-tested.
import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from "adhan";
import { londonTime } from "@/lib/clock";

// Moonsighting Committee Worldwide angles with its seasonal adjustments, Hanafi
// asr: the method most UK South Asian mosques' timetables are based on
// (analytics/generator/synth/outside/calendar.py prayer_times).
export const COMPUTED_METHOD = "computed:moonsighting_committee+hanafi";

export type PrayerRow = {
  day: string;
  fajr: string;
  sunrise: string | null;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  method: string;
};

const PRAYERS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;
type Prayer = (typeof PRAYERS)[number];

function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function computedPrayerRows(lat: number, lon: number, from: string, to: string): PrayerRow[] {
  const params = CalculationMethod.MoonsightingCommittee();
  params.madhab = Madhab.Hanafi;
  const where = new Coordinates(lat, lon);
  const rows: PrayerRow[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const [y, m, d] = day.split("-").map(Number);
    // adhan reads the date's own year, month and day (whatever the server's time zone).
    const t = new PrayerTimes(where, new Date(y, m - 1, d), params);
    rows.push({
      day,
      fajr: t.fajr.toISOString(),
      sunrise: t.sunrise.toISOString(),
      dhuhr: t.dhuhr.toISOString(),
      asr: t.asr.toISOString(),
      maghrib: t.maghrib.toISOString(),
      isha: t.isha.toISOString(),
      method: COMPUTED_METHOD,
    });
  }
  return rows;
}

// ---------- A mosque timetable (CSV) ----------
//
// One row per day: a date column and the start ("begins") time of each prayer,
// London time. Jamaat times are ignored. Accepted:
//   dates   2026-11-01, 01/11/2026, 1/11/26
//   times   05:12, 5:12, 5.12, 1:05 pm; without am/pm, afternoon prayers are
//           read as afternoon (dhuhr 1:05 = 13:05, asr 2:40 = 14:40)
//   headers Date, Fajr, Sunrise/Shuruq, Dhuhr/Zuhr/Zohr, Asr, Maghrib/Magrib, Isha/Esha
//           ("Fajr begins" is fine; a column with "jama" in its name is skipped)

const ALIASES: Record<Prayer, string[]> = {
  fajr: ["fajr", "fajar", "subh"],
  sunrise: ["sunrise", "shuruq", "shurooq", "sun rise"],
  dhuhr: ["dhuhr", "zuhr", "zohr", "duhr", "dhuhur", "zuhur"],
  asr: ["asr"],
  maghrib: ["maghrib", "magrib", "maghreb"],
  isha: ["isha", "esha", "ishaa"],
};

export type TimetableResult = { mosque: string; rows: PrayerRow[]; problems: string[] };

function splitCsv(line: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function readDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return valid(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}
function valid(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
}

// "1:05", "13:05", "1.05 pm" -> minutes after midnight, for this prayer.
export function readTime(s: string, prayer: Prayer): number | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  if (m[3] === "pm" && h < 12) h += 12;
  else if (m[3] === "am" && h === 12) h = 0;
  else if (!m[3]) {
    if (prayer === "dhuhr" && h < 10) h += 12;
    if ((prayer === "asr" || prayer === "maghrib") && h < 12) h += 12;
    if (prayer === "isha" && h >= 3 && h < 12) h += 12;
  }
  return h * 60 + min;
}

export function parseTimetable(csv: string, mosque: string): TimetableResult {
  const problems: string[] = [];
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { mosque, rows: [], problems: ["The file has no rows."] };
  const header = splitCsv(lines[0]).map((h) => h.toLowerCase());
  const dateCol = header.findIndex((h) => h.includes("date"));
  if (dateCol < 0) problems.push('No "Date" column.');
  const cols = {} as Record<Prayer, number>;
  for (const p of PRAYERS) {
    cols[p] = header.findIndex((h) => !h.includes("jama") && !h.includes("iqam") && ALIASES[p].some((a) => h.includes(a)));
    if (cols[p] < 0 && p !== "sunrise") problems.push(`No ${p} column.`);
  }
  if (problems.length) return { mosque, rows: [], problems };
  const rows: PrayerRow[] = [];
  const method = `timetable:${mosque.trim().slice(0, 60)}`;
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsv(line);
    const day = readDate(cells[dateCol] ?? "");
    if (!day) {
      problems.push(`Row ${i + 2}: can't read the date "${cells[dateCol] ?? ""}".`);
      return;
    }
    const [y, mo, d] = day.split("-").map(Number);
    const times = {} as Record<Prayer, string | null>;
    for (const p of PRAYERS) {
      if (cols[p] < 0) {
        times[p] = null;
        continue;
      }
      const mins = readTime(cells[cols[p]] ?? "", p);
      if (mins === null) {
        if (p !== "sunrise") problems.push(`Row ${i + 2} (${day}): can't read ${p} "${cells[cols[p]] ?? ""}".`);
        times[p] = null;
        continue;
      }
      // Isha after midnight belongs to the next calendar date.
      const next = p === "isha" && mins < 3 * 60 ? 1 : 0;
      times[p] = londonTime(y, mo, d + next, Math.floor(mins / 60), mins % 60).toISOString();
    }
    if (!times.fajr || !times.dhuhr || !times.asr || !times.maghrib || !times.isha) return;
    if (!(times.fajr < times.dhuhr && times.dhuhr < times.asr && times.asr < times.maghrib && times.maghrib < times.isha)) {
      problems.push(`Row ${i + 2} (${day}): the times aren't in order (fajr, dhuhr, asr, maghrib, isha).`);
      return;
    }
    rows.push({ day, fajr: times.fajr, sunrise: times.sunrise, dhuhr: times.dhuhr, asr: times.asr, maghrib: times.maghrib, isha: times.isha, method });
  });
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.day)) problems.push(`${r.day} is in the file twice.`);
    seen.add(r.day);
  }
  return { mosque, rows, problems };
}
