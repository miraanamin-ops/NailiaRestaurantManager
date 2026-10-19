// School holidays from a council's term dates. Councils publish terms (each
// with its half term); the holidays are the half terms plus every day between
// terms (the generator's rule, analytics/generator/synth/outside/calendar.py
// school_holidays). Inset days are set by schools, so the builder adds any
// that matter as their own rows. Pure, unit-tested.
import type { CalendarFeedRow } from "./types";

export type SchoolDate = {
  council_code: string;
  kind: "term" | "inset";
  start_day: string;
  end_day: string;
  half_term_start?: string | null;
  half_term_end?: string | null;
  academic_year?: string;
  notes?: string | null;
};

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// The academic year a day falls in: September to August ("2026-27").
export function academicYearOf(day: string) {
  const y = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 9 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function holidayName(start: string) {
  const m = Number(start.slice(5, 7));
  if (m === 12 || m === 1) return "Christmas holidays";
  if (m === 3 || m === 4) return "Easter holidays";
  if (m === 7 || m === 8) return "Summer holidays";
  return "School holidays";
}

export function holidayRows(councilCode: string, councilName: string, dates: SchoolDate[], fetchedAt: string): CalendarFeedRow[] {
  const terms = dates.filter((d) => d.kind === "term" && d.council_code === councilCode).sort((a, b) => a.start_day.localeCompare(b.start_day));
  const spans: { start: string; end: string; name: string }[] = [];
  for (const t of terms) {
    if (t.half_term_start && t.half_term_end) spans.push({ start: t.half_term_start, end: t.half_term_end, name: "Half term" });
  }
  for (let i = 0; i + 1 < terms.length; i++) {
    const start = addDays(terms[i].end_day, 1);
    const end = addDays(terms[i + 1].start_day, -1);
    if (end >= start) spans.push({ start, end, name: holidayName(start) });
  }
  const base = { external_source: "school-dates", type: "school_holiday" as const, scope: "council" as const, council_code: councilCode, source: "builder" as const, fetched_at: fetchedAt };
  const rows: CalendarFeedRow[] = spans
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s) => ({ ...base, external_id: `${councilCode}:holiday:${s.start}`, day: s.start, end_day: s.end === s.start ? null : s.end, name: `${s.name} (${councilName})` }));
  for (const d of dates.filter((x) => x.kind === "inset" && x.council_code === councilCode)) {
    rows.push({ ...base, type: "inset_day", external_id: `${councilCode}:inset:${d.start_day}`, day: d.start_day, end_day: d.end_day === d.start_day ? null : d.end_day,
      name: `Inset day (${councilName})`, notes: d.notes ?? null });
  }
  return rows;
}

// The last day a council's saved term dates cover (the end of its last term).
export function datesKnownUntil(dates: SchoolDate[]) {
  return dates.filter((d) => d.kind === "term").reduce<string | null>((max, d) => (!max || d.end_day > max ? d.end_day : max), null);
}

// Councils of active restaurants whose dates run out within `months` (or have none).
export function councilsShort(
  councils: { code: string; name: string; dates_known_until: string | null }[],
  needed: string[],
  today: string,
  months: number,
) {
  const [y, m, d] = today.split("-").map(Number);
  const until = new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
  return [...new Set(needed)].map((code) => {
    const c = councils.find((x) => x.code === code);
    return { code, name: c?.name ?? code, knownUntil: c?.dates_known_until ?? null, short: !c?.dates_known_until || c.dates_known_until < until };
  }).filter((c) => c.short);
}

// Term dates the builder pastes or imports (CSV): kind,start,end,half_term_start,half_term_end,notes
// kind is "term" or "inset"; dates YYYY-MM-DD or DD/MM/YYYY.
export function parseSchoolDatesCsv(csv: string, councilCode: string): { rows: SchoolDate[]; problems: string[] } {
  const rows: SchoolDate[] = [];
  const problems: string[] = [];
  const read = (s: string | undefined) => {
    const t = (s ?? "").trim();
    if (!t) return null;
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return t;
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
  };
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  lines.forEach((line, i) => {
    const c = line.split(",").map((x) => x.trim());
    if (i === 0 && /kind/i.test(c[0])) return;
    const kind = c[0]?.toLowerCase();
    const [start, end, hs, he] = [read(c[1]), read(c[2]), read(c[3]), read(c[4])];
    if (kind !== "term" && kind !== "inset") return void problems.push(`Line ${i + 1}: the first column must be "term" or "inset".`);
    if (!start || !end || start === undefined || end === undefined) return void problems.push(`Line ${i + 1}: needs a start and end date.`);
    if (hs === undefined || he === undefined || Boolean(hs) !== Boolean(he)) return void problems.push(`Line ${i + 1}: the half term needs both dates (or neither).`);
    const row: SchoolDate = { council_code: councilCode, kind, start_day: start, end_day: end, half_term_start: hs, half_term_end: he, academic_year: academicYearOf(start), notes: c[5] || null };
    const p = schoolDateProblems(row);
    if (p) problems.push(`Line ${i + 1}: ${p}`);
    else rows.push(row);
  });
  return { rows, problems };
}

export function schoolDateProblems(r: SchoolDate): string | null {
  if (r.end_day < r.start_day) return "the end is before the start.";
  if (r.kind === "term" && (r.half_term_start || r.half_term_end)) {
    if (!r.half_term_start || !r.half_term_end) return "the half term needs both dates.";
    if (r.half_term_start < r.start_day || r.half_term_end > r.end_day || r.half_term_end < r.half_term_start) return "the half term must be inside the term.";
  }
  const days = (Date.parse(r.end_day) - Date.parse(r.start_day)) / 86_400_000;
  if (r.kind === "term" && (days < 40 || days > 130)) return "a term is usually 6 to 18 weeks; check the dates.";
  if (r.kind === "inset" && days > 3) return "an inset day entry covers more than 4 days; check the dates.";
  return null;
}
