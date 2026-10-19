import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { addDays } from "./calendar-dates";
import { coverage, type CoverageInput } from "./coverage";
import { calendarApplies, type ScopedRow } from "./scope";

// The numbers behind coverage() for one restaurant, from the tables the feeds fill.

type Cal = ScopedRow & { day: string; end_day: string | null; type: string; name: string; external_source: string | null; source: string };

const maxDay = (rows: { day: string }[]) => rows.reduce<string | null>((m, r) => (!m || r.day > m ? r.day : m), null);

export async function coverageFor(restaurantId: string, now = new Date(), days = 14) {
  const supabase = getSupabase();
  const today = londonYmd(now);
  const last = addDays(today, days - 1);
  const r = check(
    await supabase.from("restaurants").select("id, nation, council_code, religious_authority, prayer_method").eq("id", restaurantId)
      .maybeSingle<{ id: string; nation: string | null; council_code: string | null; religious_authority: string | null; prayer_method: string | null }>(),
  );
  if (!r) throw new Error("No such restaurant");
  const relevance = check(await supabase.from("calendar_relevance").select("event_id, relevant").eq("restaurant_id", restaurantId).returns<{ event_id: string; relevant: boolean | null }[]>()) ?? [];
  const nearby = new Set(relevance.filter((x) => x.relevant !== false).map((x) => x.event_id));
  const cal = (
    check(
      await supabase
        .from("local_calendar")
        .select("id, restaurant_id, day, end_day, type, name, scope, region, council_code, authority, external_source, source, expected_size")
        .or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
        .gte("day", addDays(today, -1))
        .returns<(Cal & { expected_size: number | null })[]>(),
    ) ?? []
  ).filter((c) => calendarApplies(c, r, nearby));
  const ofType = (t: string) => cal.filter((c) => c.type === t);
  const inWindow = (c: { day: string; end_day: string | null }) => c.day <= last && (c.end_day ?? c.day) >= today;
  const council = r.council_code
    ? check(await supabase.from("councils").select("dates_known_until").eq("code", r.council_code).maybeSingle<{ dates_known_until: string | null }>())
    : null;

  const issuedSince = new Date(now.getTime() - 30 * 3_600_000).toISOString();
  const forecasts =
    check(
      await supabase
        .from("weather_forecasts")
        .select("target_day, hour_start")
        .eq("restaurant_id", restaurantId)
        .gte("issued_at", issuedSince)
        .returns<{ target_day: string | null; hour_start: string | null }[]>(),
    ) ?? [];
  const forecastDays = new Set(forecasts.map((f) => f.target_day).filter((d): d is string => Boolean(d && d >= today && d <= addDays(today, 7)))).size;
  const actual = check(
    await supabase.from("weather_days").select("day").eq("restaurant_id", restaurantId).order("day", { ascending: false }).limit(1).maybeSingle<{ day: string }>(),
  );
  const prayers =
    check(
      await supabase.from("prayer_times").select("day, method").eq("restaurant_id", restaurantId).gte("day", today).lte("day", last).returns<{ day: string; method: string }[]>(),
    ) ?? [];
  const teams = check(await supabase.from("restaurant_teams").select("team").eq("restaurant_id", restaurantId).returns<{ team: string }[]>()) ?? [];
  const status = check(await supabase.from("feed_status").select("feed, last_success_at, fresh_hours").returns<{ feed: string; last_success_at: string | null; fresh_hours: number | null }[]>()) ?? [];
  const fresh = (feed: string) => {
    const s = status.find((x) => x.feed === feed);
    return Boolean(s?.last_success_at && now.getTime() - new Date(s.last_success_at).getTime() < (s.fresh_hours ?? 50) * 3_600_000);
  };
  const cricket = ofType("sport").filter(inWindow);
  const events = ofType("local_event").filter(inWindow);

  const input: CoverageInput = {
    today,
    days,
    bankHolidaysThrough: maxDay(ofType("bank_holiday")),
    religiousThrough: maxDay(ofType("religious")),
    diwaliThrough: maxDay(cal.filter((c) => c.type === "cultural" && /diwali/i.test(c.name))),
    paydaysThrough: maxDay(ofType("payday")),
    clockChangesThrough: maxDay(ofType("clock_change")),
    schoolDatesThrough: council?.dates_known_until ?? null,
    hasCouncil: Boolean(r.council_code),
    prayerDays: new Set(prayers.map((p) => p.day)).size,
    forecastDays,
    forecastHours: forecasts.filter((f) => f.hour_start).length,
    actualsThrough: actual?.day ?? null,
    footballThrough: maxDay(ofType("football").filter((c) => c.external_source === "football-data.org")),
    footballFresh: fresh("football"),
    teams: teams.length,
    cricketMatches: cricket.length,
    eventsFresh: fresh("events"),
    eventsNear: events.length,
    eventsWithSize: events.filter((e) => e.expected_size != null).length,
    disruptionFresh: fresh("disruption"),
    disruptionDays: ofType("disruption").filter(inWindow).length,
  };
  return { input, rows: coverage(input) };
}
