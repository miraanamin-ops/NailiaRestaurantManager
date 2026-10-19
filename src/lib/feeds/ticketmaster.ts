// Local events from the Ticketmaster Discovery API (free key, 5,000 calls a
// day, 5 a second; TICKETMASTER_API_KEY): events within 5 km of a restaurant
// for the next 60 days. Pure, unit-tested.
//
// Ticketmaster doesn't say how many people go, so an event's size is its
// venue's typical crowd when the venue is one of ours (venues table, the
// builder can add more); otherwise it's stored with no size and the model
// leaves it out until the builder gives its venue a crowd.
import type { CalendarFeedRow } from "./types";
import type { Venue } from "./football";

export const DISCOVERY = "https://app.ticketmaster.com/discovery/v2/events.json";
export const PAGE_SIZE = 200;

export function eventsUrl(key: string, p: { lat: number; lon: number }, from: Date, to: Date, page: number, radiusKm: number) {
  const q = new URLSearchParams({
    apikey: key,
    latlong: `${p.lat},${p.lon}`,
    radius: String(radiusKm),
    unit: "km",
    startDateTime: from.toISOString().replace(/\.\d{3}Z$/, "Z"),
    endDateTime: to.toISOString().replace(/\.\d{3}Z$/, "Z"),
    size: String(PAGE_SIZE),
    page: String(page),
    sort: "date,asc",
    countryCode: "GB",
  });
  return `${DISCOVERY}?${q}`;
}

type TmVenue = { id?: string; name?: string; location?: { latitude?: string; longitude?: string } };
type TmEvent = {
  id: string;
  name: string;
  url?: string;
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string };
    end?: { localDate?: string; dateTime?: string };
    status?: { code?: string };
  };
  classifications?: { segment?: { name?: string }; genre?: { name?: string } }[];
  _embedded?: { venues?: TmVenue[] };
};
export type EventsAnswer = { _embedded?: { events?: TmEvent[] }; page?: { totalPages?: number; number?: number } };

export const venueKey = (name: string) => name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");

// Our venue for a Ticketmaster venue: by its id, else by name (and the id is then saved).
export function matchVenue(v: TmVenue | undefined, venues: (Venue & { ticketmaster_id?: string | null })[]) {
  if (!v) return null;
  const byId = v.id ? venues.find((x) => x.ticketmaster_id === v.id) : undefined;
  if (byId) return byId;
  const key = venueKey(v.name ?? "");
  if (!key) return null;
  // Or one name starts with the other ("ExCeL" and "ExCeL London"), if the shorter is long enough to mean one place.
  const prefix = (a: string, b: string) => Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a));
  return venues.find((x) => venueKey(x.name) === key || prefix(venueKey(x.name), key)) ?? null;
}

export type EventFeedRow = CalendarFeedRow & { tm_venue_id: string | null; matched_venue_id: string | null };

export function eventRows(json: EventsAnswer, venues: (Venue & { ticketmaster_id?: string | null })[], fetchedAt: string): { rows: EventFeedRow[]; removed: string[] } {
  const rows: EventFeedRow[] = [];
  const removed: string[] = [];
  for (const e of json._embedded?.events ?? []) {
    const status = e.dates?.status?.code ?? "";
    const externalId = e.id;
    if (status === "cancelled" || status === "postponed") {
      removed.push(externalId);
      continue;
    }
    const day = e.dates?.start?.localDate;
    if (!day) continue;
    const tmVenue = e._embedded?.venues?.[0];
    const lat = Number(tmVenue?.location?.latitude);
    const lon = Number(tmVenue?.location?.longitude);
    const ours = matchVenue(tmVenue, venues);
    const endDay = e.dates?.end?.localDate && e.dates.end.localDate > day ? e.dates.end.localDate : null;
    const segment = e.classifications?.[0]?.segment?.name;
    rows.push({
      external_source: "ticketmaster",
      external_id: externalId,
      day,
      end_day: endDay,
      starts_at: e.dates?.start?.dateTime ? new Date(e.dates.start.dateTime).toISOString() : null,
      ends_at: e.dates?.end?.dateTime ? new Date(e.dates.end.dateTime).toISOString() : null,
      name: `${e.name}${tmVenue?.name ? ` (${tmVenue.name})` : ""}`.slice(0, 200),
      type: "local_event",
      scope: "local",
      latitude: Number.isFinite(lat) && lat !== 0 ? lat : (ours?.latitude ?? null),
      longitude: Number.isFinite(lon) && lon !== 0 ? lon : (ours?.longitude ?? null),
      venue_id: ours?.id ?? null,
      expected_size: ours ? (ours.typical_crowd ?? ours.capacity) : null,
      notes: segment ? `${segment}${e.url ? `. ${e.url}` : ""}` : (e.url ?? null),
      source: "feed",
      fetched_at: fetchedAt,
      tm_venue_id: tmVenue?.id ?? null,
      matched_venue_id: ours?.id ?? null,
    });
  }
  return { rows, removed };
}

// Ticketmaster stops at 1,000 results per search (page x size).
export const lastPage = (json: EventsAnswer) => Math.min((json.page?.totalPages ?? 1) - 1, Math.floor(1000 / PAGE_SIZE) - 1);
