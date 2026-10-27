import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { ensureLocated } from "@/lib/feeds/location";
import { addDaysYmd, mondayOf, type DayAhead, type WeekAhead } from "@/lib/forecast/week-ahead-rules";
import { postcodeOf } from "@/lib/sales/weather-data";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { getUpcomingEvents } from "@/lib/upcoming-events";
import type { BriefOffer } from "@/lib/sections/types";
import { calendarLines, coverageNote, lineText, pickSuggestion, type CalendarLine, type SchoolCoverage } from "./rules";

// The local calendar for owners (./rules.ts says what shows and why): the lines
// for the brief and the report, the restaurant's school-holiday coverage, and
// the one campaign idea a morning (saved in calendar_suggestions, so an event
// is only ever offered once).

type Located = Pick<Restaurant, "id" | "address"> & { council_code?: string | null; council_name?: string | null; latitude?: number | null; longitude?: number | null; nation?: string | null; weather_cell?: string | null; prayer_method?: string | null };

// Which council's school holidays apply: from the restaurant's postcode
// (postcodes.io, saved on the restaurant once), then whether we hold that
// council's term dates.
export async function schoolCoverage(restaurantId: string, today: string): Promise<SchoolCoverage> {
  const r = check(
    await getSupabase()
      .from("restaurants")
      .select("id, address, council_code, council_name, latitude, longitude, nation, weather_cell, prayer_method")
      .eq("id", restaurantId)
      .maybeSingle<Located>(),
  );
  if (!r) return { status: "no_postcode" };
  let code = r.council_code ?? null;
  if (!code) {
    if (!postcodeOf(r.address)) return { status: "no_postcode" };
    code = (await ensureLocated(r).catch(() => null))?.councilCode ?? null;
    if (!code) return { status: "no_postcode" };
  }
  const c = check(await getSupabase().from("councils").select("name, dates_known_until").eq("code", code).maybeSingle<{ name: string; dates_known_until: string | null }>());
  // Just located: its council's name was saved on the restaurant with the code.
  const saved = r.council_name ?? check(await getSupabase().from("restaurants").select("council_name").eq("id", restaurantId).maybeSingle<{ council_name: string | null }>())?.council_name;
  const name = c?.name ?? saved ?? "your council";
  return c?.dates_known_until && c.dates_known_until >= today ? { status: "covered", council: name } : { status: "not_covered", council: name };
}

// The lines for the days from..to (London), with the forecast's days to judge what
// moves. Events that began before `from` (a half term already on) say "Until ...".
export async function linesBetween(restaurantId: string, from: string, to: string, weeks: WeekAhead[]) {
  const days = new Map<string, DayAhead>();
  let show = weeks.length > 0;
  for (const w of weeks) {
    show = show && w.show_ranges;
    for (const d of w.days) days.set(d.date, d);
  }
  const yesterday = addDaysYmd(from, -1);
  const events = await getUpcomingEvents(restaurantId, yesterday, to);
  const lines = calendarLines(events, days, show);
  return lines
    .map((l) => {
      const startedBefore = l.first === yesterday;
      if (startedBefore && l.last === yesterday) return null; // ended yesterday
      const line: CalendarLine = startedBefore ? { ...l, first: from } : l;
      return { line, startedBefore, text: lineText(line, from, to, startedBefore) };
    })
    .filter((x): x is { line: CalendarLine; startedBefore: boolean; text: string } => x !== null);
}


// Saves the morning's idea (once per event); null if it was already offered.
async function offerSuggestion(restaurantId: string, today: string, lines: CalendarLine[]): Promise<BriefOffer | null> {
  const offered = new Set(
    (
      check(
        await getSupabase()
          .from("calendar_suggestions")
          .select("event_key")
          .eq("restaurant_id", restaurantId)
          .in("event_key", lines.map((l) => l.key))
          .returns<{ event_key: string }[]>(),
      ) ?? []
    ).map((r) => r.event_key),
  );
  const pick = pickSuggestion(lines, today, offered);
  if (!pick) return null;
  const row = check(
    await getSupabase()
      .from("calendar_suggestions")
      .insert({ restaurant_id: restaurantId, event_key: pick.line.key, day: pick.line.first, title: pick.line.title, question: pick.s.question, request: pick.s.request, offered_on: today })
      .select("id")
      .single<{ id: string }>(),
  );
  return row ? { id: row.id, question: pick.s.question } : null;
}

// The brief's calendar block: the next 3 days every morning, the whole week on a
// Monday (with the school-holiday note when they aren't covered), and at most one
// campaign idea. weekAhead: the forecast for a Monday (shared with the finance block).
export async function calendarBlock(
  r: Pick<Restaurant, "id">,
  now: Date,
  weekAhead: (weekStart: string) => Promise<WeekAhead>,
): Promise<{ text: string | null; offers: BriefOffer[] }> {
  const today = londonYmd(now);
  const monday = mondayOf(today) === today;
  const to = monday ? addDaysYmd(today, 6) : addDaysYmd(today, 2);
  const weekStarts = [...new Set([mondayOf(today), mondayOf(to)])];
  const [weeks, coverage] = await Promise.all([Promise.all(weekStarts.map(weekAhead)), monday ? schoolCoverage(r.id, today) : Promise.resolve(null)]);
  const lines = await linesBetween(r.id, today, to, weeks);
  const note = coverage ? coverageNote(coverage) : null;
  if (!lines.length && !note) return { text: null, offers: [] };
  const offer = lines.length ? await offerSuggestion(r.id, today, lines.map((l) => l.line)) : null;
  const text = [monday ? "📅 *This week*" : "📅 *Coming up*", ...lines.map((l) => l.text), ...(lines.length ? [] : ["Nothing in the local calendar that should change trade."]), ...(note ? [note] : [])].join("\n");
  return { text, offers: offer ? [offer] : [] };
}

// ---------- The owner's tap ----------

export type CalendarSuggestionRow = { id: string; restaurant_id: string; day: string; title: string; question: string; request: string; status: "offered" | "drafted" | "declined"; draft_id: string | null };

export async function calendarSuggestionById(restaurantId: string, id: string) {
  return check(await getSupabase().from("calendar_suggestions").select("*").eq("restaurant_id", restaurantId).eq("id", id).maybeSingle<CalendarSuggestionRow>());
}

export async function markSuggestion(restaurantId: string, id: string, change: { status: "drafted" | "declined"; draft_id?: string | null; decided_at: string }) {
  check(await getSupabase().from("calendar_suggestions").update(change).eq("restaurant_id", restaurantId).eq("id", id));
}
