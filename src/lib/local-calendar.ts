import "server-only";
import { bankHolidays } from "@/lib/bank-holidays";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { bankHolidayRows, type CalendarEntry } from "./local-calendar-rules";

// The local calendar in the database (supabase/023_growth.sql): rows for every
// restaurant (restaurant_id empty) and rows for one restaurant. The builder fills
// it from builder controls; UK bank holidays come from gov.uk.

// This restaurant's calendar (its own rows and the shared ones) between two dates.
export async function calendarFor(restaurantId: string, from: string, to: string) {
  return (
    check(
      await getSupabase()
        .from("local_calendar")
        .select("id, restaurant_id, day, name, type, date_uncertain, source")
        .or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
        .gte("day", from)
        .lte("day", to)
        .order("day")
        .returns<CalendarEntry[]>(),
    ) ?? []
  );
}

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
    if (rows.length) check(await supabase.from("local_calendar").insert(rows.map((row) => ({ ...row, restaurant_id: null }))));
    return rows.length;
  } catch (err) {
    console.error("Couldn't add the bank holidays to the local calendar", err);
    return 0;
  }
}
