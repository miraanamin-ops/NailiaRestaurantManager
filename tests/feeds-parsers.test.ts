// The outside data feeds' pure parts (src/lib/feeds/), against real answers saved
// from each provider (tests/fixtures/feeds/; football-data.org and Ticketmaster
// are shaped from their documented answers until a key is set, see
// scripts/save-feed-fixtures.mjs). No network.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseBuilderCommand, isBuilderNumber, resolveDateWord } from "@/lib/feeds/builder-parse";
import { bankHolidayRows, clockChangeRows, culturalRows, diwali, mothersDay, paydayRows, religiousRows, ummAlQura } from "@/lib/feeds/calendar-dates";
import { feedProblem, historicImport, missingKey, nextRunAt, plannedFeedJobs } from "@/lib/feeds/config";
import { coverage, uncovered, type CoverageInput } from "@/lib/feeds/coverage";
import { canonicalTeam, competitionText, fixtureRows, manualMatchProblems, manualMatchRow, type Venue } from "@/lib/feeds/football";
import { historyRows, seasonsBetween } from "@/lib/feeds/football-history";
import { fromPostcode } from "@/lib/feeds/location";
import { ownerEventCard, ownerEventFrom, ownerEventRow } from "@/lib/feeds/owner-events";
import { computedPrayerRows, parseTimetable, readTime } from "@/lib/feeds/prayer";
import { calendarApplies } from "@/lib/feeds/scope";
import { academicYearOf, councilsShort, datesKnownUntil, holidayRows, parseSchoolDatesCsv, type SchoolDate } from "@/lib/feeds/school-terms";
import { disruptionRows, nearbyLines } from "@/lib/feeds/tfl";
import { eventRows, lastPage, matchVenue } from "@/lib/feeds/ticketmaster";
import { cellCentre, cellOf, dayActuals, forecastRows, hourActuals, londonMidnight, modelRunAt, previousRunRows } from "@/lib/feeds/weather-data";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/feeds/${name}`, import.meta.url), "utf8"));
const NOW = "2026-10-19T00:00:00.000Z";

const VENUES: (Venue & { ticketmaster_id: string | null })[] = [
  { id: "v-ls", name: "London Stadium", latitude: 51.53833, longitude: -0.01658, capacity: 62500, typical_crowd: 60000, teams: ["West Ham"], ticketmaster_id: null },
  { id: "v-ex", name: "ExCeL London", latitude: 51.5085, longitude: 0.0295, capacity: 100000, typical_crowd: 25000, teams: [], ticketmaster_id: null },
  { id: "v-o2", name: "The O2", latitude: 51.50304, longitude: 0.0032, capacity: 20000, typical_crowd: 17000, teams: [], ticketmaster_id: null },
  { id: "v-th", name: "Tottenham Hotspur Stadium", latitude: 51.60433, longitude: -0.06663, capacity: 62850, typical_crowd: 60000, teams: ["Tottenham"], ticketmaster_id: null },
];

describe("weather (Open-Meteo, ECMWF IFS 0.25)", () => {
  test("restaurants share a grid cell, fetched at its centre", () => {
    expect(cellOf(51.5193, -0.0573)).toBe("51.50,0.00");
    expect(cellOf(51.559, 0.07)).toBe("51.50,0.00");
    expect(cellOf(51.583, -0.02)).toBe("51.50,0.00");
    expect(cellOf(51.63, -0.13)).toBe("51.75,-0.25");
    expect(cellCentre("51.50,0.00")).toEqual({ lat: 51.5, lon: 0 });
    expect(() => cellCentre("restaurant:x")).toThrow();
  });

  test("the forecast as issued: days 0 to 7 and hours from now on, with sunshine; past hours are actuals", () => {
    const json = fixture("openmeteo_forecast.json");
    const issued = new Date("2026-10-18T23:36:05Z"); // when it was saved (00:36 UK on 19 Oct)
    const { days, hours } = forecastRows(json, issued, "2026-10-18T12:00:00.000Z");
    expect(days.map((d) => d.target_day)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(days.every((d) => d.issued_at === issued.toISOString() && d.sunshine_hours !== null && d.temp_max !== null && d.model_run_at === "2026-10-18T12:00:00.000Z")).toBe(true);
    expect(hours[0].hour_start).toBe("2026-10-18T23:00:00.000Z");
    expect(hours.every((h) => h.hour_start! >= "2026-10-18T23:00:00.000Z" && h.sunshine_min! >= 0 && h.sunshine_min! <= 60)).toBe(true);
    expect(hours.length).toBeGreaterThan(7 * 24);
    const past = hourActuals(json, issued);
    expect(past.length).toBe(7 * 24 + 1); // 7 past days plus today's first hour (until 00:00 UK... 23:00 UTC)
    expect(past.at(-1)!.hour_start < issued.toISOString()).toBe(true);
  });

  test("archived actuals become London days, with sunshine, only when every hour is there", () => {
    const hours = hourActuals(fixture("openmeteo_archive.json"));
    // 27 to 30 March 2026 (asked in Open-Meteo's fixed-offset way: an hour of the 26th, and the 29th has 23 hours).
    expect(hours.length).toBe(96);
    const days = dayActuals(hours);
    expect(days.map((d) => d.day)).toEqual(["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"]);
    for (const d of days) {
      expect(d.temp_max!).toBeGreaterThanOrEqual(d.temp_min!);
      expect(d.sunshine_hours).not.toBeNull();
      expect(d.conditions).toBeTruthy();
    }
    expect(dayActuals(hours.slice(2)).map((d) => d.day)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]); // a day missing an hour is left out
    expect(dayActuals(hours).find((d) => d.day === "2026-03-29")).toBeTruthy(); // 23 hours is a whole day on a clock change
  });

  test("archived forecasts get the generator's issue times: N days before, from the London midnight", () => {
    const { days, hours, firstDay } = previousRunRows(fixture("openmeteo_previous.json"));
    expect(firstDay).toBe("2026-10-10");
    const d1 = days.find((d) => d.target_day === "2026-10-11" && d.issued_at === new Date(londonMidnight("2026-10-11").getTime() - 86_400_000).toISOString());
    expect(d1).toBeTruthy();
    expect(londonMidnight("2026-10-11").toISOString()).toBe("2026-10-10T23:00:00.000Z");
    expect(londonMidnight("2026-12-11").toISOString()).toBe("2026-12-11T00:00:00.000Z");
    expect(days).toHaveLength(14); // 2 days x 7 leads
    expect(days.find((d) => d.target_day === "2026-10-11" && d.issued_at === "2026-10-03T23:00:00.000Z")).toBeTruthy(); // 7 days before
    expect(hours.every((h) => Date.parse(h.hour_start!) - Date.parse(h.issued_at) <= 2 * 86_400_000)).toBe(true);
    expect(modelRunAt(fixture("openmeteo_meta.json"))).toMatch(/^2026-10-1\dT/);
  });
});

describe("the calculated calendar", () => {
  test("Umm al-Qura gives the East London Mosque's announced dates for 2024 to 2026", () => {
    const uq = ummAlQura(2024, 2026).map((x) => `${x.kind}:${x.day}`);
    for (const d of ["ramadan:2024-03-11", "eid_fitr:2024-04-10", "eid_adha:2024-06-16", "ramadan:2025-03-01", "eid_fitr:2025-03-30", "eid_adha:2025-06-06", "ramadan:2026-02-18", "eid_fitr:2026-03-20", "eid_adha:2026-05-27"]) {
      expect(uq).toContain(d);
    }
  });

  test("Ramadan, both Eids and chand raat, expected and uncertain, with the alternative filled", () => {
    const rows = religiousRows("east-london-mosque", 2027, 2028, NOW);
    const fitr27 = rows.find((r) => r.external_id === "east-london-mosque:eid_fitr:1448")!;
    expect(fitr27).toMatchObject({ day: "2027-03-09", date_uncertain: true, alt_day: "2027-03-10", authority: "east-london-mosque", type: "religious", scope: "national" });
    expect(rows.find((r) => r.external_id === "east-london-mosque:ramadan:1448")).toMatchObject({ day: "2027-02-08", end_day: "2027-03-08", date_uncertain: true, alt_day: "2027-02-09" });
    expect(rows.find((r) => r.external_id === "east-london-mosque:chand_raat:1448")).toMatchObject({ day: "2027-03-08", type: "cultural", name: "Chand raat", alt_day: "2027-03-09" });
    expect(rows.find((r) => r.external_id === "east-london-mosque:eid_adha:1448")).toMatchObject({ day: "2027-05-16", alt_day: "2027-05-17" });
    // Two years: 2027 and 2028 (and the Eid al-Adha of 1449).
    expect(rows.filter((r) => r.name === "Eid al-Fitr").map((r) => r.day)).toEqual(["2027-03-09", "2028-02-26"]);
    // The model reads Ramadan, Eid al-Fitr and Eid al-Adha by name; chand raat isn't "religious", so it never takes a moon-sighting blend.
    expect(rows.filter((r) => r.type === "religious").every((r) => /^(Ramadan|Eid al-Fitr|Eid al-Adha)$/.test(r.name))).toBe(true);
  });

  test("announced dates are used as they are; UK moon sighting is a day later with Umm al-Qura as the alternative", () => {
    const elm = religiousRows("east-london-mosque", 2025, 2026, NOW);
    expect(elm.find((r) => r.name === "Eid al-Adha" && r.day === "2025-06-06")).toMatchObject({ date_uncertain: false, alt_day: null });
    expect(elm.find((r) => r.name === "Ramadan" && r.day === "2026-02-18")).toMatchObject({ end_day: "2026-03-19", date_uncertain: true, alt_day: "2026-02-19" });
    const uk = religiousRows("uk-moonsighting", 2026, 2027, NOW);
    expect(uk.find((r) => r.name === "Eid al-Fitr" && r.day.startsWith("2026"))).toMatchObject({ day: "2026-03-21", alt_day: "2026-03-20" });
    expect(uk.find((r) => r.name === "Eid al-Fitr" && r.day.startsWith("2027"))).toMatchObject({ day: "2027-03-10", alt_day: "2027-03-09", date_uncertain: true });
  });

  test("Diwali, calculated, matches the published dates 2019 to 2030; two possible evenings are marked uncertain", () => {
    const want: Record<number, string> = {
      2019: "2019-10-27", 2020: "2020-11-14", 2021: "2021-11-04", 2022: "2022-10-24", 2023: "2023-11-12", 2024: "2024-10-31",
      2025: "2025-10-20", 2026: "2026-11-08", 2027: "2027-10-29", 2028: "2028-10-17", 2029: "2029-11-05", 2030: "2030-10-26",
    };
    for (const [y, day] of Object.entries(want)) expect(diwali(Number(y))?.day, y).toBe(day);
    expect(diwali(2024)?.alt).toBe("2024-11-01");
    expect(diwali(2025)?.alt).toBe("2025-10-21");
    expect(diwali(2026)?.alt).toBeNull();
  });

  test("Christmas, Mother's Day, Valentine's; paydays skip weekends and bank holidays; clock changes are named for the model", () => {
    expect(mothersDay(2027)).toBe("2027-03-07");
    const c = culturalRows(2027, 2027, NOW).map((r) => `${r.name}:${r.day}`);
    expect(c).toEqual(expect.arrayContaining(["Valentine's Day:2027-02-14", "Mother's Day:2027-03-07", "Christmas Day:2027-12-25", "Diwali:2027-10-29"]));
    const pay = paydayRows(2026, 2027, new Set(["2026-12-25", "2027-08-30"]), NOW).map((r) => r.day);
    expect(pay).toContain("2026-10-30"); // Friday
    expect(pay).toContain("2027-01-29"); // Friday, not Sunday 31
    expect(pay).toContain("2027-08-31"); // Tuesday after the bank holiday Monday
    expect(pay).toHaveLength(24);
    expect(clockChangeRows(2026, 2027, NOW).map((r) => `${r.name}:${r.day}`)).toEqual([
      "Clocks go forward:2026-03-29", "Clocks go back:2026-10-25", "Clocks go forward:2027-03-28", "Clocks go back:2027-10-31",
    ]);
  });

  test("gov.uk bank holidays: England and Wales, keyed by date", () => {
    const rows = bankHolidayRows(fixture("govuk_bank_holidays.json"), NOW);
    expect(rows.find((r) => r.day === "2026-12-25")).toMatchObject({ name: "Christmas Day", external_id: "england-and-wales:2026-12-25", type: "bank_holiday", source: "gov.uk" });
    expect(rows.every((r) => r.external_source === "gov.uk")).toBe(true);
    expect(() => bankHolidayRows({}, NOW)).toThrow(/no events/);
  });
});

describe("prayer times", () => {
  test("calculated as the generator does (Moonsighting Committee, Hanafi asr), to the minute", () => {
    // The generator's own numbers (adhanpy) for Whitechapel, in UTC.
    const want: Record<string, string[]> = {
      "2026-03-01": ["05:10", "06:46", "12:18", "15:48", "17:43", "19:02"],
      "2026-06-21": ["01:43", "03:43", "12:07", "17:40", "20:24", "21:42"],
      "2026-10-25": ["05:05", "06:41", "11:49", "14:56", "16:49", "18:11"],
    };
    for (const [day, times] of Object.entries(want)) {
      const [r] = computedPrayerRows(51.5193, -0.0573, day, day);
      expect([r.fajr, r.sunrise!, r.dhuhr, r.asr, r.maghrib, r.isha].map((t) => t.slice(11, 16)), day).toEqual(times);
      expect(r.method).toBe("computed:moonsighting_committee+hanafi");
    }
    expect(computedPrayerRows(51.5, 0, "2026-10-19", "2026-12-17")).toHaveLength(60);
  });

  test("a mosque timetable CSV: begins times (not jamaat), 12-hour times read as the right half of the day, isha after midnight", () => {
    const csv = [
      "Date,Fajr Begins,Fajr Jamaat,Sunrise,Zuhr Begins,Zuhr Jamaat,Asr Begins,Maghrib,Isha Begins",
      "01/11/2026,5:30,6:00,6:58,11:52,1:15,2:21,4:31,6:05",
      "2026-06-21,1:40,3:00,4:43,1:07,1:30,6:40,9:24,12:15 am",
      "02/11/2026,5:31,6:00,7:00,11:52,1:15,2:20,4:29,6:03",
    ].join("\n");
    const { rows, problems } = parseTimetable(csv, "East London Mosque");
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ day: "2026-11-01", method: "timetable:East London Mosque", fajr: "2026-11-01T05:30:00.000Z", dhuhr: "2026-11-01T11:52:00.000Z", asr: "2026-11-01T14:21:00.000Z", maghrib: "2026-11-01T16:31:00.000Z", isha: "2026-11-01T18:05:00.000Z" });
    // Summer: BST, and isha at 00:15 is the next calendar date.
    expect(rows[1]).toMatchObject({ dhuhr: "2026-06-21T12:07:00.000Z", isha: "2026-06-21T23:15:00.000Z" });
    expect(readTime("1:05", "dhuhr")).toBe(13 * 60 + 5);
    expect(readTime("11:55", "dhuhr")).toBe(11 * 60 + 55);
    expect(parseTimetable("Date,Fajr\n2026-11-01,5:30", "X").problems).toEqual(expect.arrayContaining(["No dhuhr column."]));
    expect(parseTimetable("Date,Fajr,Dhuhr,Asr,Maghrib,Isha\n2026-11-01,5:30,11:52,2:21,4:31,banana", "X").problems[0]).toMatch(/can't read isha/);
  });
});

describe("school dates", () => {
  const terms = (code: string) =>
    (JSON.parse(readFileSync(new URL("../src/lib/feeds/data/school_terms.json", import.meta.url), "utf8")).councils[code].terms as { start: string; end: string; half_term: string[] }[]).map(
      (t): SchoolDate => ({ council_code: code, kind: "term", start_day: t.start, end_day: t.end, half_term_start: t.half_term[0], half_term_end: t.half_term[1] }),
    );

  test("holidays are the half terms and the days between terms (the generator's rule); inset days are their own rows", () => {
    const rows = holidayRows("E09000026", "Redbridge", [...terms("E09000026"), { council_code: "E09000026", kind: "inset", start_day: "2026-09-01", end_day: "2026-09-01" }], NOW);
    const names = rows.map((r) => `${r.name}:${r.day}:${r.end_day ?? ""}`);
    expect(names).toContain("Christmas holidays (Redbridge):2025-12-20:2026-01-04");
    expect(names).toContain("Summer holidays (Redbridge):2026-07-21:2026-09-01");
    expect(names).toContain("Half term (Redbridge):2026-10-26:2026-10-30");
    expect(rows.find((r) => r.type === "inset_day")).toMatchObject({ day: "2026-09-01", scope: "council", council_code: "E09000026", name: "Inset day (Redbridge)" });
    expect(rows.every((r) => r.scope === "council" && r.source === "builder")).toBe(true);
    expect(datesKnownUntil(terms("E09000026"))).toBe("2026-12-18");
  });

  test("a council whose dates run out within 4 months is flagged, as is one with none", () => {
    const short = councilsShort([{ code: "A", name: "A", dates_known_until: "2026-12-18" }, { code: "B", name: "B", dates_known_until: "2027-07-20" }], ["A", "B", "C"], "2026-10-19", 4);
    expect(short.map((s) => s.code)).toEqual(["A", "C"]);
  });

  test("term dates by CSV, checked", () => {
    const { rows, problems } = parseSchoolDatesCsv("kind,start,end,half term start,half term end\nterm,04/01/2027,26/03/2027,15/02/2027,19/02/2027\ninset,2027-01-04,2027-01-04,,,Most primaries\nterm,2027-04-12,2027-04-13", "E09000026");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "term", start_day: "2027-01-04", half_term_end: "2027-02-19", academic_year: "2026-27" });
    expect(problems[0]).toMatch(/Line 4.*6 to 18 weeks/);
    expect(academicYearOf("2026-09-02")).toBe("2026-27");
  });
});

describe("football", () => {
  test("fixtures become calendar rows with kick-offs, importance words, the home crowd, and postponed ones are taken out", () => {
    const { rows, removed } = fixtureRows(fixture("football-data_PL_matches.json"), VENUES, NOW);
    expect(removed).toEqual(["PL:538103"]);
    expect(rows.map((r) => r.name)).toEqual(["West Ham v Arsenal", "Tottenham v Liverpool", "Brentford v West Ham"]);
    expect(rows[0]).toMatchObject({
      external_source: "football-data.org", external_id: "PL:538101", day: "2026-10-24", kickoff_at: "2026-10-24T14:00:00.000Z", competition: "Premier League",
      sport: "football", type: "football", scope: "national", venue_id: "v-ls", expected_size: 60000, home_team: "West Ham",
    });
    expect(rows[2]).toMatchObject({ venue_id: null, expected_size: null, notes: "Kick-off time not confirmed yet" });
    const cl = fixtureRows(fixture("football-data_CL_matches.json"), VENUES, NOW).rows;
    expect(cl[0].competition).toBe("Champions League league phase");
  });

  test("the stage is in the competition's words, the way the model weighs it", () => {
    expect(competitionText("WC", "GROUP_STAGE")).toBe("World Cup group stage");
    expect(competitionText("CL", "QUARTER_FINALS")).toBe("Champions League quarter-final");
    expect(competitionText("EC", "SEMI_FINALS")).toBe("European Championship semi-final");
    expect(competitionText("WC", "FINAL")).toBe("World Cup final");
    expect(competitionText("CL", "PLAYOFFS")).toBe("Champions League knockout play-off");
  });

  test("one name per team", () => {
    expect(canonicalTeam("Spurs")).toBe("Tottenham");
    expect(canonicalTeam(" west ham united ")).toBe("West Ham");
    expect(canonicalTeam("Nott'm Forest")).toBe("Nottingham");
    expect(canonicalTeam("arsenal", ["Arsenal"])).toBe("Arsenal");
    expect(canonicalTeam("pakistan")).toBe("Pakistan");
  });

  test("past Premier League fixtures from football-data.co.uk, with kick-off times in UK time", () => {
    const csv = readFileSync(new URL("./fixtures/feeds/fdcouk_E0_2526_head.csv", import.meta.url), "utf8");
    const rows = historyRows(csv, "2025-08-01", "2025-08-31", VENUES, NOW);
    expect(rows).toHaveLength(14);
    expect(rows.find((r) => r.name === "West Ham v Chelsea")).toMatchObject({ day: "2025-08-22", kickoff_at: "2025-08-22T19:00:00.000Z", venue_id: "v-ls", external_id: "E0:2025-08-22:West Ham:Chelsea" });
    expect(rows.find((r) => r.home_team === "Nottingham")).toBeTruthy();
    expect(seasonsBetween("2024-10-01", "2026-10-19")).toEqual(["2425", "2526", "2627"]);
  });

  test("a match the builder types in (cricket, England outside the free tier)", () => {
    const m = { sport: "cricket" as const, competition: "T20 World Cup semi-final", home: "india", away: "Pakistan", kickoff: "2026-11-14T09:30:00Z" };
    expect(manualMatchProblems(m)).toBeNull();
    expect(manualMatchRow(m, VENUES, NOW)).toMatchObject({ type: "sport", sport: "cricket", home_team: "India", external_source: "builder", external_id: "cricket:2026-11-14:India:Pakistan", ends_at: "2026-11-14T17:30:00.000Z" });
    expect(manualMatchProblems({ ...m, away: "India" })).toMatch(/same/);
    expect(manualMatchProblems({ ...m, competition: "" })).toMatch(/competition/);
  });
});

describe("local events (Ticketmaster)", () => {
  test("events near the restaurant, sized by our venues, de-duplicated by Ticketmaster's id; cancelled ones come out", () => {
    const { rows, removed } = eventRows(fixture("ticketmaster_events.json"), VENUES, NOW);
    expect(removed).toEqual(["G5vYZ9xyz04"]);
    expect(rows.map((r) => r.external_id)).toEqual(["G5vYZ9xyz01", "G5vYZ9xyz02", "G5vYZ9xyz03"]);
    expect(rows[0]).toMatchObject({ name: "Coldplay (The O2)", day: "2026-10-30", scope: "local", type: "local_event", venue_id: "v-o2", expected_size: 17000, matched_venue_id: "v-o2", tm_venue_id: "KovZ9177Arf" });
    expect(rows[1]).toMatchObject({ day: "2026-11-05", end_day: "2026-11-08", expected_size: 25000 });
    expect(rows[2]).toMatchObject({ venue_id: null, expected_size: null, latitude: 51.525 });
    expect(lastPage(fixture("ticketmaster_events.json"))).toBe(0);
    expect(lastPage({ page: { totalPages: 40 } })).toBe(4); // 1,000 results at most
  });

  test("a venue is matched by id once known, else by name", () => {
    expect(matchVenue({ name: "The O2" }, VENUES)?.id).toBe("v-o2");
    expect(matchVenue({ name: "O2 Arena" }, VENUES)).toBeNull();
    expect(matchVenue({ id: "TM1", name: "Somewhere" }, [{ ...VENUES[0], ticketmaster_id: "TM1" }])?.id).toBe("v-ls");
  });
});

describe("disruption (TfL)", () => {
  test("from the real answer: weekend part closures and an early-morning whole-line closure are left out", () => {
    const { strikes, closures } = disruptionRows(fixture("tfl_status_range.json"), NOW);
    expect(strikes).toEqual([]);
    expect(closures).toEqual([]);
  });

  test("a strike is a London day; a whole line closed in the daytime matters to restaurants near that line", () => {
    const json = [
      { id: "central", name: "Central", lineStatuses: [{ statusSeverity: 20, reason: "Central line: no service due to strike action by the RMT.", validityPeriods: [{ fromDate: "2026-11-10T04:00:00Z", toDate: "2026-11-12T01:00:00Z" }] }] },
      { id: "district", name: "District", lineStatuses: [{ statusSeverity: 4, reason: "District line: Sunday 15 November, no service on the entire line.", validityPeriods: [{ fromDate: "2026-11-15T05:00:00Z", toDate: "2026-11-16T00:30:00Z" }] }] },
    ];
    const { strikes, closures } = disruptionRows(json, NOW);
    expect(strikes).toEqual([expect.objectContaining({ day: "2026-11-10", end_day: "2026-11-11", scope: "regional", region: "london", type: "disruption", name: "Strike (Central)", external_id: "strike:central:2026-11-10T04:00:00Z" })]);
    expect(closures).toEqual([expect.objectContaining({ day: "2026-11-15", end_day: null, scope: "local", line: "district", name: "District closed" })]);
    expect(nearbyLines(fixture("tfl_stoppoints.json"))).toEqual(["central", "district", "dlr", "elizabeth", "greater-anglia", "hammersmith-city", "weaver", "windrush"]);
  });
});

describe("where a restaurant is (postcodes.io)", () => {
  test("its council and nation come from the postcode", () => {
    expect(fromPostcode(fixture("postcodes_e1.json"))).toEqual({ latitude: 51.51932, longitude: -0.057301, council_code: "E09000030", council_name: "Tower Hamlets", nation: "england" });
    expect(fromPostcode({})).toBeNull();
  });
});

describe("planning and health", () => {
  const rs = [{ id: "r1", weatherCell: "51.50,0.00" }, { id: "r2", weatherCell: "51.50,0.00" }, { id: "r3", weatherCell: null }];
  const all = { weather: true, calendar: true, prayer: true, football: true, events: true, disruption: true, school_terms: true };

  test("the 04:05 hourly run queues the daily feeds for 04:30 UK; one weather job per cell", () => {
    const now = new Date("2026-10-19T03:05:00Z"); // 04:05 UK (BST)
    const jobs = plannedFeedJobs("hourly", now, rs, all);
    const runAt = new Date("2026-10-19T03:30:00Z");
    expect(jobs.every((j) => j.runAt?.getTime() === runAt.getTime())).toBe(true);
    const weather = jobs.filter((j) => j.type === "feed_weather");
    expect(weather.map((w) => w.key)).toEqual(["feed_weather:51.50,0.00:2026-10-19:daily", "feed_weather:restaurant:r3:2026-10-19:daily"]);
    expect(weather[0].payload.restaurants).toEqual(["r1", "r2"]);
    expect(weather[1].restaurantId).toBe("r3");
    expect(jobs.filter((j) => j.type === "feed_prayer")).toHaveLength(3);
    expect(jobs.filter((j) => j.type === "feed_calendar").map((j) => j.key)).toEqual(["feed_calendar:2026-10-19"]);
    expect(plannedFeedJobs("hourly", new Date("2026-10-19T04:05:00Z"), rs, all)).toEqual([]); // 05:05: nothing
  });

  test("the 06:05 run queues the 06:45 weather refresh only; the 09:00 backup queues the daily ones (same keys) to start at once", () => {
    const refresh = plannedFeedJobs("hourly", new Date("2026-10-19T05:05:00Z"), rs, all);
    expect(refresh.map((j) => j.key)).toEqual(["feed_weather:51.50,0.00:2026-10-19:refresh", "feed_weather:restaurant:r3:2026-10-19:refresh"]);
    expect(refresh[0].runAt?.toISOString()).toBe("2026-10-19T05:45:00.000Z");
    const backup = plannedFeedJobs("daily", new Date("2026-10-19T09:00:00Z"), rs, all);
    expect(backup.some((j) => j.type === "feed_weather" && j.key.endsWith(":refresh"))).toBe(false);
    expect(backup.every((j) => j.runAt === undefined)).toBe(true);
    expect(backup.map((j) => j.key)).toEqual(plannedFeedJobs("hourly", new Date("2026-10-19T03:05:00Z"), rs, all).map((j) => j.key));
    // In winter 04:30 UK is 04:30 UTC.
    expect(plannedFeedJobs("hourly", new Date("2026-12-01T04:05:00Z"), rs, all)[0].runAt?.toISOString()).toBe("2026-12-01T04:30:00.000Z");
  });

  test("a feed switched off isn't queued; a missing key is a skip, not an error (TfL's is optional)", () => {
    const jobs = plannedFeedJobs("daily", new Date("2026-10-19T09:00:00Z"), rs, { ...all, events: false, weather: false });
    expect(jobs.some((j) => j.type === "feed_events" || j.type === "feed_weather")).toBe(false);
    expect(missingKey("football", {})).toBe("no FOOTBALL_DATA_API_KEY set");
    expect(missingKey("events", { TICKETMASTER_API_KEY: "  " })).toBe("no TICKETMASTER_API_KEY set");
    expect(missingKey("events", { TICKETMASTER_API_KEY: "k" })).toBeNull();
    expect(missingKey("disruption", {})).toBeNull();
    expect(missingKey("weather", {})).toBeNull();
  });

  test("stale or failing feeds are problems for the builder; skipped and switched-off ones aren't", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const base = { feed: "weather", enabled: true, fresh_hours: 26, last_success_at: "2026-10-19T03:40:00Z", last_outcome: "ok", last_error: null, last_run_at: "2026-10-19T03:40:00Z" };
    expect(feedProblem(base, now)).toBeNull();
    expect(feedProblem({ ...base, last_success_at: "2026-10-17T03:40:00Z" }, now)).toMatch(/56 hours old/);
    expect(feedProblem({ ...base, last_outcome: "failed", last_error: "open-meteo 500" }, now)).toMatch(/failing: open-meteo 500/);
    expect(feedProblem({ ...base, last_outcome: "skipped", last_success_at: null }, now)).toBeNull();
    expect(feedProblem({ ...base, enabled: false, last_success_at: null }, now)).toBeNull();
    expect(nextRunAt("weather", new Date("2026-10-19T04:00:00Z"))?.toISOString()).toBe("2026-10-19T05:45:00.000Z");
    expect(nextRunAt("calendar", new Date("2026-10-19T04:00:00Z"))?.toISOString()).toBe("2026-10-20T03:30:00.000Z");
  });

  test("a POS import counts as history when it's over 30 days old", () => {
    expect(historicImport("2026-01-01", "2026-10-19")).toBe(true);
    expect(historicImport("2026-10-01", "2026-10-19")).toBe(false);
  });
});

describe("which shared rows a restaurant sees (the app's copy of the database rule)", () => {
  const r = { id: "A", nation: "england", council_code: "E09000026", religious_authority: "east-london-mosque" };
  test("by scope", () => {
    const rule = (row: object, near = new Set<string>()) => calendarApplies({ id: "x", restaurant_id: null, ...row }, r, near);
    expect(rule({ scope: null })).toBe(true);
    expect(rule({ scope: "national", authority: "uk-moonsighting" })).toBe(false);
    expect(rule({ scope: "regional", region: "london" })).toBe(true);
    expect(rule({ scope: "regional", region: "scotland" })).toBe(false);
    expect(rule({ scope: "council", council_code: "E09000025" })).toBe(false);
    expect(rule({ scope: "local" })).toBe(false);
    expect(rule({ scope: "local" }, new Set(["x"]))).toBe(true);
    expect(calendarApplies({ id: "y", restaurant_id: "B" }, r, new Set())).toBe(false);
  });
});

describe("builder commands", () => {
  test("only from the builder's number", () => {
    expect(isBuilderNumber("whatsapp:+447700900123", "whatsapp:+447700900123")).toBe(true);
    expect(isBuilderNumber("whatsapp:+447700900123", "+44 7700 900123")).toBe(true);
    expect(isBuilderNumber("whatsapp:+447700900999", "whatsapp:+447700900123")).toBe(false);
    expect(isBuilderNumber("whatsapp:+447700900123", undefined)).toBe(false);
  });

  test("Eid confirmed for Tuesday, and the other forms", () => {
    expect(parseBuilderCommand("BUILDER Eid confirmed for Tuesday")).toEqual({ kind: "confirm", what: "eid", date: { kind: "weekday", weekday: 2 }, authority: "east-london-mosque" });
    expect(parseBuilderCommand("builder eid al-adha confirmed 27 May")).toMatchObject({ what: "eid_adha", date: { kind: "date", day: 27, month: 5, year: null } });
    expect(parseBuilderCommand("BUILDER RAMADAN STARTS WEDNESDAY UK")).toMatchObject({ what: "ramadan", authority: "uk-moonsighting", date: { weekday: 3 } });
    expect(parseBuilderCommand("BUILDER eid ul fitr is confirmed tomorrow")).toMatchObject({ what: "eid_fitr", date: { kind: "relative", days: 1 } });
    expect(parseBuilderCommand("BUILDER DIWALI CONFIRMED 2027-10-29")).toMatchObject({ what: "diwali", date: { kind: "date", year: 2027 } });
    expect(parseBuilderCommand("BUILDER RUN weather")).toEqual({ kind: "run", feed: "weather" });
    expect(parseBuilderCommand("BUILDER FEEDS")).toEqual({ kind: "feeds" });
    expect(parseBuilderCommand("BUILDER")).toEqual({ kind: "help" });
    expect(parseBuilderCommand("BUILDER eid confirmed someday").kind).toBe("unknown");
  });

  test("a weekday means the one within 3 days of the expected date", () => {
    expect(resolveDateWord({ kind: "weekday", weekday: 3 }, "2027-03-09", "2027-03-07")).toBe("2027-03-10"); // expected Tuesday, confirmed Wednesday
    expect(resolveDateWord({ kind: "weekday", weekday: 2 }, "2027-03-09", "2027-03-07")).toBe("2027-03-09");
    expect(resolveDateWord({ kind: "relative", days: 1 }, "2027-03-09", "2027-03-08")).toBe("2027-03-09");
    expect(resolveDateWord({ kind: "date", day: 31, month: 2, year: null }, "2027-03-09", "2027-03-08")).toBeNull();
  });
});

describe("owner-reported events", () => {
  test("checked, shown as a card, saved as the restaurant's own event", () => {
    const e = ownerEventFrom({ name: "  Valentines Park  summer fair ", date: "2026-10-24", size: "medium" }, "2026-10-19")!;
    expect(e).toEqual({ name: "Valentines Park summer fair", day: "2026-10-24", end_day: null, size: "medium" });
    expect(ownerEventFrom({ name: "Fair", date: "2026-10-01" }, "2026-10-19")).toBeNull(); // in the past
    expect(ownerEventFrom({ name: "", date: "2026-10-24" }, "2026-10-19")).toBeNull();
    expect(ownerEventCard(e, (d) => d)).toMatch(/Add to your local calendar\?\n- Valentines Park summer fair: 2026-10-24 \(a few thousand people\)/);
    expect(ownerEventRow(e, { id: "R", latitude: 51.5, longitude: 0.07 }, "D1")).toMatchObject({
      restaurant_id: "R", scope: "restaurant", type: "local_event", source: "owner_message", external_source: "owner_message", external_id: "R:D1", expected_size: 3000, latitude: 51.5,
    });
  });
});

describe("coverage", () => {
  const full: CoverageInput = {
    today: "2026-10-19", days: 14, bankHolidaysThrough: "2028-12-26", religiousThrough: "2028-05-05", diwaliThrough: "2028-10-17", paydaysThrough: "2028-12-29",
    clockChangesThrough: "2028-10-29", schoolDatesThrough: "2026-12-18", hasCouncil: true, prayerDays: 14, forecastDays: 8, forecastHours: 180,
    actualsThrough: "2026-10-18", footballThrough: "2026-12-12", footballFresh: true, teams: 1, cricketMatches: 0, eventsFresh: true, eventsNear: 3,
    eventsWithSize: 2, disruptionFresh: true, disruptionDays: 0,
  };
  test("every factor live when every source covers the window (weather days 0 to 7; cricket is builder entry)", () => {
    expect(uncovered(coverage(full))).toEqual([]);
    expect(coverage(full).find((r) => r.group === "Cricket")?.status).toBe("builder entry");
  });
  test("a gap shows", () => {
    const rows = uncovered(coverage({ ...full, schoolDatesThrough: "2026-10-25", forecastDays: 5, eventsFresh: false }));
    expect(rows.map((r) => r.group)).toEqual(["School holidays and inset days", "Weather forecast", "Local events and venues"]);
  });
});
