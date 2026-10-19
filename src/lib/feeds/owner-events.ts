// An event the owner tells Naila about ("there's a fair on Saturday"): read by
// today's assistant (the add_local_event tool), shown as a confirm card (a
// "change to your details" card, never sent to anyone), and on Approve added
// to the restaurant's own calendar with source owner_message. Pure, unit-tested.
import type { CalendarFeedRow } from "./types";

export const EVENT_SIZES = { small: 500, medium: 3000, large: 10000 } as const;
export type EventSize = keyof typeof EVENT_SIZES | "unknown";
const SIZE_WORDS: Record<EventSize, string> = { small: "a few hundred people", medium: "a few thousand people", large: "10,000 or more", unknown: "size not known" };

export type OwnerEvent = { name: string; day: string; end_day: string | null; size: EventSize };

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// The tool's input, checked: a name, a day from today to a year ahead, an end on or after it (at most 3 weeks).
export function ownerEventFrom(input: Record<string, unknown>, today: string): OwnerEvent | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  const day = typeof input.date === "string" && iso.test(input.date) ? input.date : null;
  if (!name || !day || day < today || day > addDays(today, 365)) return null;
  let end = typeof input.end_date === "string" && iso.test(input.end_date) && input.end_date > day ? input.end_date : null;
  if (end && end > addDays(day, 21)) end = null;
  const size = (["small", "medium", "large"] as const).includes(input.size as "small") ? (input.size as EventSize) : "unknown";
  return { name, day, end_day: end, size };
}

export function ownerEventCard(e: OwnerEvent, dayLabel: (d: string) => string) {
  return `Add to your local calendar?\n- ${e.name}: ${dayLabel(e.day)}${e.end_day ? ` to ${dayLabel(e.end_day)}` : ""} (${SIZE_WORDS[e.size]})\n\nIt helps Naila expect busier (or quieter) days.`;
}

// The calendar row on Approve: the restaurant's own, at the restaurant (so "near" is distance 0).
export function ownerEventRow(e: OwnerEvent, restaurant: { id: string; latitude?: number | null; longitude?: number | null }, draftId: string): CalendarFeedRow {
  return {
    external_source: "owner_message",
    external_id: `${restaurant.id}:${draftId}`,
    restaurant_id: restaurant.id,
    day: e.day,
    end_day: e.end_day,
    name: e.name,
    type: "local_event",
    scope: "restaurant",
    latitude: restaurant.latitude ?? null,
    longitude: restaurant.longitude ?? null,
    expected_size: e.size === "unknown" ? null : EVENT_SIZES[e.size],
    source: "owner_message",
    notes: "Told to Naila by the owner",
  };
}
