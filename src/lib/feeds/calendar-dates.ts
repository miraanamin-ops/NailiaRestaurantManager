// The calculated calendar: religious and cultural dates, paydays, clock
// changes, and the bank holidays from gov.uk's answer. Pure, unit-tested
// (tests/feeds-calendar.test.ts). Rules ported from the synthetic data
// generator (analytics/generator/synth/outside/calendar.py).
import { Coordinates, CalculationMethod, PrayerTimes } from "adhan";
import { elongation, lahiri, sunLongitude, whenAngle } from "./astro";
import observedJson from "./data/religious.json";
import type { CalendarFeedRow } from "./types";

export const AUTHORITIES = ["east-london-mosque", "uk-moonsighting"] as const;
export type Authority = (typeof AUTHORITIES)[number];
export const AUTHORITY_LABEL: Record<Authority, string> = {
  "east-london-mosque": "East London Mosque",
  "uk-moonsighting": "UK moon sighting",
};

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (day: string, n: number) => ymd(utc(day) + n * DAY);

// ---------- Islamic dates ----------
//
// Expected dates come from the Umm al-Qura calendar (built into Node's Intl).
// It matched the East London Mosque's announced dates for Ramadan, Eid al-Fitr
// and Eid al-Adha in 2024, 2025 and 2026. Moon sighting can move any of them a
// day, so every expected date is marked uncertain with the other day as its
// alternative, until the builder confirms it:
//   east-london-mosque  expected = Umm al-Qura, alternative = the day after
//   uk-moonsighting     expected = the day after, alternative = Umm al-Qura
// Dates already announced (data/religious.json, checked against the mosque's
// own pages) are used as they are.

const hijri = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
function hijriOf(ms: number) {
  const p = Object.fromEntries(hijri.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { year: parseInt(p.year, 10), month: Number(p.month), day: Number(p.day) };
}

// Every 1 Ramadan, 1 Shawwal (Eid al-Fitr) and 10 Dhu al-Hijjah (Eid al-Adha) by Umm al-Qura, by Gregorian year.
export function ummAlQura(fromYear: number, toYear: number) {
  const out: { hijriYear: number; kind: "ramadan" | "eid_fitr" | "eid_adha"; day: string }[] = [];
  for (let t = Date.UTC(fromYear, 0, 1); t < Date.UTC(toYear + 1, 0, 1); t += DAY) {
    const h = hijriOf(t);
    if (h.month === 9 && h.day === 1) out.push({ hijriYear: h.year, kind: "ramadan", day: ymd(t) });
    if (h.month === 10 && h.day === 1) out.push({ hijriYear: h.year, kind: "eid_fitr", day: ymd(t) });
    if (h.month === 12 && h.day === 10) out.push({ hijriYear: h.year, kind: "eid_adha", day: ymd(t) });
  }
  return out;
}

type Observed = { name: string; kind: string; start: string; end: string; uncertain: boolean; alternatives?: string[] };
const OBSERVED = (observedJson as { events: Observed[] }).events;
const firstDate = (s: string) => s.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;

// The announced dates for an authority, by kind and day. The East London Mosque's
// are in the file; UK moon sighting's are its alternatives (when listed).
function announced(authority: Authority) {
  return OBSERVED.map((e) => {
    const alt = e.alternatives?.map(firstDate).find(Boolean) ?? null;
    if (authority === "east-london-mosque") return { kind: e.kind, start: e.start, end: e.end, uncertain: e.uncertain, alt };
    if (!alt) return { kind: e.kind, start: e.start, end: e.end, uncertain: e.uncertain, alt: null };
    const shift = (utc(alt) - utc(e.start)) / DAY;
    return { kind: e.kind, start: alt, end: addDays(e.end, shift), uncertain: true, alt: e.start };
  });
}

const NAMES = { ramadan: "Ramadan", eid_fitr: "Eid al-Fitr", eid_adha: "Eid al-Adha" } as const;

// Ramadan, both Eids and chand raat (the night before Eid al-Fitr) for the
// years given, for one authority. Ramadan runs from the first fast to the last
// (the day before Eid al-Fitr).
export function religiousRows(authority: Authority, fromYear: number, toYear: number, fetchedAt: string): CalendarFeedRow[] {
  const known = announced(authority);
  // Umm al-Qura over one more year either side, so a Ramadan that ends in January still finds its Eid.
  const uq = ummAlQura(fromYear - 1, toYear + 1);
  const byYear = new Map<number, Partial<Record<"ramadan" | "eid_fitr" | "eid_adha", string>>>();
  for (const x of uq) byYear.set(x.hijriYear, { ...byYear.get(x.hijriYear), [x.kind]: x.day });
  const shift = authority === "uk-moonsighting" ? 1 : 0;
  const rows: CalendarFeedRow[] = [];
  for (const [hYear, k] of byYear) {
    // The date for one kind: announced if it matches this Hijri year (within 3 days of Umm al-Qura), else expected.
    const pick = (kind: keyof typeof NAMES) => {
      const uqDay = k[kind];
      if (!uqDay) return null;
      const a = known.find((x) => x.kind === kind && Math.abs((utc(x.start) - utc(uqDay)) / DAY) <= 3);
      if (a) return { day: a.start, end: a.end, uncertain: a.uncertain, alt: a.uncertain ? (a.alt ?? addDays(a.start, 1)) : null, announced: true };
      const day = addDays(uqDay, shift);
      return { day, end: day, uncertain: true, alt: shift ? uqDay : addDays(uqDay, 1), announced: false };
    };
    const ram = pick("ramadan");
    const fitr = pick("eid_fitr");
    const adha = pick("eid_adha");
    const base = { external_source: "religious", authority, scope: "national" as const, source: "feed" as const, fetched_at: fetchedAt };
    const note = (p: { announced: boolean; alt: string | null }) =>
      `${p.announced ? `As announced (${AUTHORITY_LABEL[authority]})` : `Expected (${AUTHORITY_LABEL[authority]}, Umm al-Qura calendar)`}${p.alt ? `. Alternative dates: ${p.alt}` : ""}`;
    if (ram && fitr) {
      const year = Number(ram.day.slice(0, 4));
      if (year >= fromYear && year <= toYear) {
        rows.push({ ...base, external_id: `${authority}:ramadan:${hYear}`, day: ram.day, end_day: addDays(fitr.day, -1), name: NAMES.ramadan, type: "religious",
          date_uncertain: ram.uncertain, alt_day: ram.alt, notes: note(ram) });
      }
    }
    for (const [kind, p] of [["eid_fitr", fitr], ["eid_adha", adha]] as const) {
      if (!p) continue;
      const year = Number(p.day.slice(0, 4));
      if (year < fromYear || year > toYear) continue;
      rows.push({ ...base, external_id: `${authority}:${kind}:${hYear}`, day: p.day, name: NAMES[kind], type: "religious",
        date_uncertain: p.uncertain, alt_day: p.alt, notes: note(p) });
      if (kind === "eid_fitr") {
        // Chand raat is 'cultural', so the forecast's moon-sighting blend (religious rows) isn't spent on it:
        // the model works chand raat out from Eid al-Fitr's own row.
        rows.push({ ...base, external_id: `${authority}:chand_raat:${hYear}`, day: addDays(p.day, -1), name: "Chand raat", type: "cultural",
          date_uncertain: p.uncertain, alt_day: p.alt ? addDays(p.alt, -1) : null, notes: "The night before Eid al-Fitr" });
      }
    }
  }
  return rows.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
}

// ---------- Diwali ----------
//
// Lakshmi Puja: the evening of the new moon (amavasya) that ends the lunar month
// Ashvin, i.e. the first new moon after the sun enters sidereal Libra (Tula
// sankranti, Lahiri), on the day when amavasya (the last 12 degrees before the
// new moon) covers pradosh (sunset to 2h24m after) in Delhi. When it covers
// pradosh on two evenings, the first is the expected day (as most UK temples)
// and the second is the alternative (some UK councils list that one).

const DELHI = new Coordinates(28.6139, 77.209);

function delhiSunset(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new PrayerTimes(DELHI, new Date(y, m - 1, d), CalculationMethod.MuslimWorldLeague()).maghrib.getTime();
}
// Delhi's calendar day of an instant (IST, UTC+5:30).
const istDay = (ms: number) => ymd(ms + 5.5 * 3_600_000);

export function diwali(year: number): { day: string; alt: string | null } | null {
  const sankranti = whenAngle(sunLongitude, 180 + lahiri(year), Date.UTC(year, 8, 25), 40);
  if (!sankranti) return null;
  const newMoon = whenAngle(elongation, 0, sankranti, 32);
  if (!newMoon) return null;
  const start = whenAngle(elongation, 348, newMoon - 3 * DAY, 3);
  if (!start || start > newMoon) return null;
  const covered: string[] = [];
  for (let d = istDay(start) ; d <= istDay(newMoon); d = addDays(d, 1)) {
    const s = delhiSunset(d);
    const e = s + 144 * 60_000;
    if (Math.min(e, newMoon) - Math.max(s, start) > 0) covered.push(d);
  }
  if (!covered.length) return null;
  return { day: covered[0], alt: covered[1] ?? null };
}

// ---------- Other cultural dates ----------

export function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(Date.UTC(year, month - 1, day));
}

// UK Mothering Sunday: three weeks before Easter Sunday.
export const mothersDay = (year: number) => addDays(easter(year), -21);

export function culturalRows(fromYear: number, toYear: number, fetchedAt: string): CalendarFeedRow[] {
  const rows: CalendarFeedRow[] = [];
  const base = { external_source: "cultural", type: "cultural" as const, scope: "national" as const, source: "feed" as const, fetched_at: fetchedAt };
  for (let y = fromYear; y <= toYear; y++) {
    rows.push({ ...base, external_id: `valentines:${y}`, day: `${y}-02-14`, name: "Valentine's Day" });
    rows.push({ ...base, external_id: `mothers_day:${y}`, day: mothersDay(y), name: "Mother's Day" });
    rows.push({ ...base, external_id: `christmas_eve:${y}`, day: `${y}-12-24`, name: "Christmas Eve" });
    rows.push({ ...base, external_id: `christmas:${y}`, day: `${y}-12-25`, name: "Christmas Day" });
    rows.push({ ...base, external_id: `new_years_eve:${y}`, day: `${y}-12-31`, name: "New Year's Eve" });
    const d = diwali(y);
    if (d) {
      rows.push({ ...base, external_id: `diwali:${y}`, day: d.day, name: "Diwali", date_uncertain: Boolean(d.alt), alt_day: d.alt,
        notes: d.alt ? `Calculated (Lakshmi Puja, Delhi pradosh). Alternative dates: ${d.alt}` : "Calculated (Lakshmi Puja, Delhi pradosh)" });
    }
  }
  return rows;
}

// ---------- Paydays and clock changes ----------

const lastSunday = (year: number, month: number) => {
  const last = Date.UTC(year, month, 0);
  return ymd(last - new Date(last).getUTCDay() * DAY);
};

export function clockChangeRows(fromYear: number, toYear: number, fetchedAt: string): CalendarFeedRow[] {
  const rows: CalendarFeedRow[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (const [m, name] of [[3, "Clocks go forward"], [10, "Clocks go back"]] as const) {
      const day = lastSunday(y, m);
      rows.push({ external_source: "rule", external_id: `clock:${day}`, day, name, type: "clock_change", scope: "national", source: "feed", fetched_at: fetchedAt });
    }
  }
  return rows;
}

// The last working day of each month (the most common UK payday): not a weekend, not a bank holiday.
export function paydayRows(fromYear: number, toYear: number, bankHolidays: Set<string>, fetchedAt: string): CalendarFeedRow[] {
  const rows: CalendarFeedRow[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 1; m <= 12; m++) {
      let t = Date.UTC(y, m, 0);
      while ([0, 6].includes(new Date(t).getUTCDay()) || bankHolidays.has(ymd(t))) t -= DAY;
      const day = ymd(t);
      rows.push({ external_source: "rule", external_id: `payday:${day}`, day, name: "Payday (last working day)", type: "payday", scope: "national", source: "feed", fetched_at: fetchedAt });
    }
  }
  return rows;
}

// ---------- Bank holidays (gov.uk) ----------

type GovUk = Record<string, { division?: string; events?: { title: string; date: string; notes?: string }[] }>;

// England and Wales (every restaurant so far). Shared, national, as they were saved before.
export function bankHolidayRows(json: GovUk, fetchedAt: string): CalendarFeedRow[] {
  const events = json["england-and-wales"]?.events ?? [];
  if (!events.length) throw new Error("gov.uk bank holidays: no events for England and Wales");
  return events.map((e) => ({
    external_source: "gov.uk", external_id: `england-and-wales:${e.date}`, day: e.date, name: e.title, type: "bank_holiday" as const,
    source: "gov.uk" as const, fetched_at: fetchedAt, notes: e.notes || null,
  }));
}
