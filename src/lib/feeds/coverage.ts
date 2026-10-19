// Which of the forecast model's factors have outside data for the days ahead,
// for one restaurant. Pure: the numbers come from coverage-data.ts. Used by
// /feeds, scripts/feed-coverage.mjs (through /api/feeds) and the test that one
// full feed run covers the next 14 days (tests/feeds-run.test.ts).
//
// "Covered" means the source is known for every day in the window, not that
// something happens: no strike in the next fortnight is data too, once TfL has
// been asked. The weather forecast covers days 0 to 7; after that the model
// uses the seasonal normal by design (weather.py), so days 0 to 7 are the test.

export type CoverageInput = {
  today: string;
  days: number;
  bankHolidaysThrough: string | null;
  religiousThrough: string | null; // the restaurant's authority
  diwaliThrough: string | null;
  paydaysThrough: string | null;
  clockChangesThrough: string | null;
  schoolDatesThrough: string | null; // its council's term dates
  hasCouncil: boolean;
  prayerDays: number; // days in the window with prayer times the restaurant uses
  forecastDays: number; // days 0 to 7 with a forecast issued in the last 30 hours
  forecastHours: number; // hours with a forecast issued in the last 30 hours
  actualsThrough: string | null; // last day of actual weather
  footballThrough: string | null; // last kick-off day from the football feed
  footballFresh: boolean;
  teams: number; // the restaurant's teams (plus national teams from the defaults)
  cricketMatches: number; // builder-entered cricket matches in the window
  eventsFresh: boolean; // Ticketmaster asked within its freshness
  eventsNear: number; // events near the restaurant in the window
  eventsWithSize: number;
  disruptionFresh: boolean;
  disruptionDays: number;
};

export type CoverageRow = {
  group: string;
  factors: string[];
  source: string;
  status: "live" | "missing" | "builder entry";
  through: string | null;
  note: string;
};

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export function coverage(c: CoverageInput): CoverageRow[] {
  const last = addDays(c.today, c.days - 1);
  const through = (t: string | null) => Boolean(t && t >= last);
  const row = (group: string, factors: string[], source: string, ok: boolean, t: string | null, note: string): CoverageRow => ({
    group, factors, source, status: ok ? "live" : "missing", through: t, note,
  });
  const forecastNeeded = Math.min(8, c.days);
  return [
    row("Bank holidays", ["bank_holiday", "bh_eve", "bh_after"], "gov.uk", through(c.bankHolidaysThrough), c.bankHolidaysThrough, "gov.uk lists about 2 years ahead"),
    row("Christmas, New Year, Mother's Day, Valentine's", ["xmas_eve", "xmas_week", "nye", "new_year", "mothers_day", "valentines"], "worked out by the model from the date", true, null, "no data needed"),
    row("Religious dates", ["ramadan_1_10", "ramadan_11_20", "ramadan_last10", "eid_fitr_d1..3", "eid_adha_d1..3", "chand_raat"], "Umm al-Qura, the authority's announcements", through(c.religiousThrough), c.religiousThrough, "uncertain until the builder confirms"),
    row("Diwali", ["diwali"], "calculated", through(c.diwaliThrough), c.diwaliThrough, ""),
    row("Paydays", ["payday_window"], "calculated", through(c.paydaysThrough), c.paydaysThrough, "last working day of the month"),
    row("Clock changes", ["clock_change_fwd", "clock_change_back"], "calculated", through(c.clockChangesThrough), c.clockChangesThrough, ""),
    row("School holidays and inset days", ["school_holiday", "inset_day"], "council term dates (builder)", c.hasCouncil && through(c.schoolDatesThrough), c.schoolDatesThrough,
      !c.hasCouncil ? "the restaurant has no council yet" : "inset days only where the builder entered them"),
    row("Prayer times (Ramadan and Jummah hours)", ["hour profile: maghrib, dhuhr"], "calculated, or a mosque timetable", c.prayerDays >= c.days, c.prayerDays >= c.days ? last : null, `${c.prayerDays} of ${c.days} days`),
    row("Weather forecast", ["temp_warm", "temp_cold", "temp_hot", "rain_lunch", "rain_dinner", "sunshine"], "Open-Meteo (ECMWF)", c.forecastDays >= forecastNeeded && c.forecastHours > 0,
      c.forecastDays ? addDays(c.today, c.forecastDays - 1) : null, `days 0 to 7 as issued (${c.forecastDays} of ${forecastNeeded}); later days use the seasonal normal`),
    row("Weather actuals", ["(history and normals)"], "Open-Meteo archive (ERA5)", Boolean(c.actualsThrough && c.actualsThrough >= addDays(c.today, -2)), c.actualsThrough, "up to yesterday"),
    row("Football", ["football_during", "football_after"], "football-data.org", c.footballFresh && through(c.footballThrough), c.footballThrough,
      `${c.teams} team(s) followed; England friendlies, qualifiers and Nations League by builder entry`),
    { group: "Cricket", factors: ["cricket_during", "cricket_after"], source: "builder entry", status: "builder entry", through: null, note: `${c.cricketMatches} match(es) entered for the window` },
    row("Local events and venues", ["venue"], "Ticketmaster + seeded venues", c.eventsFresh, c.eventsFresh ? last : null, `${c.eventsNear} event(s) near, ${c.eventsWithSize} with a crowd size`),
    row("Disruption", ["disruption"], "TfL (National Rail by builder entry)", c.disruptionFresh, c.disruptionFresh ? last : null, `${c.disruptionDays} disrupted day(s) in the window`),
  ];
}

export const uncovered = (rows: CoverageRow[]) => rows.filter((r) => r.status === "missing");
