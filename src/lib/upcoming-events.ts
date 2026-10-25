import "server-only";
import { londonYmd } from "@/lib/clock";
import { dummyDataAllowed } from "@/lib/dummy-data";
import { calendarFor } from "@/lib/local-calendar";
import { restaurantEventsBetween } from "@/lib/ops/outside";
import { dummyUpcomingEvents, expectedEffect, sortEvents, sourceOf, type UpcomingEvent } from "./upcoming-events-rules";

const RESTAURANT_EVENT_TITLES: Record<string, string> = {
  closure: "Closed",
  partial_closure: "Partly closed",
  refit: "Refit",
  menu_change: "Menu change",
  price_change: "Price change",
  promotion: "Offer running",
  short_staffed: "Short-staffed",
  other: "Something unusual",
};

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Upcoming events between two London days, inclusive (docs/pilot-sprint.md): the
// local calendar that applies to this restaurant (lib/local-calendar.ts) and the
// restaurant's own events, one entry per day, soonest first. In test mode a demo
// restaurant with none gets dummy events (source "dummy").
export async function getUpcomingEvents(restaurantId: string, from: string, to: string): Promise<UpcomingEvent[]> {
  if (to < from) return [];
  const [calendar, own] = await Promise.all([
    calendarFor(restaurantId, from, to),
    restaurantEventsBetween(restaurantId, `${from}T00:00:00Z`, `${addDays(to, 1)}T00:00:00Z`),
  ]);
  const events: UpcomingEvent[] = calendar.map((c) => ({
    date: c.day,
    title: c.name,
    type: c.type,
    expected_effect: expectedEffect(c.type, c.name),
    source: sourceOf(c.source),
  }));
  for (const e of own) {
    const title = e.notes?.trim() ? `${RESTAURANT_EVENT_TITLES[e.type] ?? "Event"}: ${e.notes.trim()}` : (RESTAURANT_EVENT_TITLES[e.type] ?? "Event");
    const first = londonYmd(new Date(e.starts_at));
    const last = londonYmd(new Date(e.ends_at ?? e.starts_at));
    for (let d = first < from ? from : first; d <= last && d <= to; d = addDays(d, 1)) {
      events.push({ date: d, title, type: "restaurant", expected_effect: expectedEffect("restaurant", title, e.type), source: e.created_by === "owner" ? "owner" : "builder" });
    }
  }
  if (!events.length && (await dummyDataAllowed(restaurantId))) return dummyUpcomingEvents(from, to);
  return sortEvents(events);
}
