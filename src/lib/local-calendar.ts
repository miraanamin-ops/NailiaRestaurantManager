import "server-only";
import { bankHolidays } from "@/lib/bank-holidays";
import { check } from "@/lib/drafts";
import { calendarApplies, type ScopedRow } from "@/lib/feeds/scope";
import { getSupabase } from "@/lib/supabase";
import { bankHolidayRows, CALENDAR_TYPES, type CalendarEntry } from "./local-calendar-rules";

// The local calendar in the database (supabase/023_growth.sql): rows for every
// restaurant (restaurant_id empty) and rows for one restaurant. The builder fills
// it from builder controls; UK bank holidays come from gov.uk; the outside data
// feeds (lib/feeds) add the rest, shared rows with a scope.

// This restaurant's calendar between two dates: its own rows and the shared ones
// that apply to it (lib/feeds/scope.ts: its council's school holidays, its
// authority's Eid, events near it), of the kinds Growth plans around.
export async function calendarFor(restaurantId: string, from: string, to: string) {
  const supabase = getSupabase();
  const rows =
    check(
      await supabase
        .from("local_calendar")
        .select("id, restaurant_id, day, name, type, date_uncertain, source, scope, region, council_code, authority")
        .or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
        .in("type", [...CALENDAR_TYPES])
        .gte("day", from)
        .lte("day", to)
        .order("day")
        .returns<(CalendarEntry & ScopedRow)[]>(),
    ) ?? [];
  if (!rows.some((r) => !r.restaurant_id && r.scope && r.scope !== "national")) {
    return rows.filter((r) => calendarApplies(r, { id: restaurantId }, new Set())).map(entry);
  }
  const [restaurant, near] = await Promise.all([
    supabase.from("restaurants").select("id, nation, council_code, religious_authority").eq("id", restaurantId).maybeSingle<{ id: string; nation: string | null; council_code: string | null; religious_authority: string | null }>(),
    supabase.from("calendar_relevance").select("event_id, relevant").eq("restaurant_id", restaurantId).returns<{ event_id: string; relevant: boolean | null }[]>(),
  ]);
  const nearby = new Set((check(near) ?? []).filter((x) => x.relevant !== false).map((x) => x.event_id));
  const r = check(restaurant) ?? { id: restaurantId };
  return rows.filter((row) => calendarApplies(row, r, nearby)).map(entry);
}

const entry = (r: CalendarEntry & ScopedRow): CalendarEntry => ({
  id: r.id, restaurant_id: r.restaurant_id, day: r.day, name: r.name, type: r.type, date_uncertain: r.date_uncertain, source: r.source,
});

// Adds the UK bank holidays from gov.uk that aren't in the calendar yet (shared by
// every restaurant). Uses the same weekly cache as Visibility's bank holiday check.
// Never throws: the calendar still works without them.
export async function syncBankHolidays(today: string) {
  try {
    const supabase = getSupabase();
    const existing =
      check(
        await supabase
          .from("local_calendar")
          .select("day, name")
          .is("restaurant_id", null)
          .eq("source", "gov.uk")
          .gte("day", today)
          .returns<Pick<CalendarEntry, "day" | "name">[]>(),
      ) ?? [];
    const rows = bankHolidayRows(await bankHolidays(), existing, today);
    // Shared by every restaurant: restaurant_id stays empty on purpose.
    // The calendar feed's key too, so it updates these rows instead of adding them again.
    if (rows.length) {
      check(
        await supabase
          .from("local_calendar")
          .insert(rows.map((row) => ({ ...row, restaurant_id: null, external_source: "gov.uk", external_id: `england-and-wales:${row.day}` }))),
      );
    }
    return rows.length;
  } catch (err) {
    console.error("Couldn't add the bank holidays to the local calendar", err);
    return 0;
  }
}
