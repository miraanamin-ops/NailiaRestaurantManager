import "server-only";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { hoursFromGoogle } from "./profile-data";
import type { GoogleCandidate } from "./store";

// Finding a restaurant on Google (Places API, new version). Needs
// GOOGLE_PLACES_API_KEY. Without it, onboarding still works: this step is skipped.

const BASE = "https://places.googleapis.com/v1";
const PHOTO_BUCKET = "post-photos";
const MAX_PHOTOS = 3;

export function placesAvailable() {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

async function places<T>(path: string, init: RequestInit & { fieldMask: string }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": init.fieldMask,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type PlaceSummary = { id: string; displayName?: { text: string }; formattedAddress?: string };

// "Ember & Spice Grill" (optionally plus an area or postcode) -> up to 3 likely matches in the UK.
export async function searchPlaces(query: string): Promise<GoogleCandidate[]> {
  const out = await places<{ places?: PlaceSummary[] }>("/places:searchText", {
    method: "POST",
    body: JSON.stringify({ textQuery: query, regionCode: "GB", maxResultCount: 3 }),
    fieldMask: "places.id,places.displayName,places.formattedAddress",
  });
  return (out.places ?? []).map((p) => ({ id: p.id, name: p.displayName?.text ?? query, address: p.formattedAddress ?? "" }));
}

type PlaceDetails = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  primaryTypeDisplayName?: { text: string };
  photos?: { name: string }[];
};

export async function placeDetails(placeId: string) {
  return places<PlaceDetails>(`/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    fieldMask:
      "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,regularOpeningHours,rating,userRatingCount,websiteUri,primaryTypeDisplayName,photos",
  });
}

// Copies a few photos into our own storage, so no Google key ever appears in a link.
async function savePhotos(restaurantId: string, photos: { name: string }[]) {
  const urls: string[] = [];
  for (const [i, p] of photos.slice(0, MAX_PHOTOS).entries()) {
    try {
      const res = await fetch(`${BASE}/${p.name}/media?maxWidthPx=1200&key=${process.env.GOOGLE_PLACES_API_KEY}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      const path = `${restaurantId}/google-${i + 1}-${Date.now()}.jpg`;
      const storage = getSupabase().storage.from(PHOTO_BUCKET);
      const { error } = await storage.upload(path, bytes, { contentType: res.headers.get("content-type") ?? "image/jpeg", upsert: true });
      if (!error) urls.push(storage.getPublicUrl(path).data.publicUrl);
    } catch (err) {
      console.error("Couldn't copy a Google photo", err);
    }
  }
  return urls;
}

// "Yes, that's us": everything we can take from Google, in the restaurant's own fields.
export async function profileFromPlace(restaurantId: string, placeId: string): Promise<Partial<Restaurant>> {
  const d = await placeDetails(placeId);
  const hours = hoursFromGoogle(d.regularOpeningHours?.weekdayDescriptions ?? []);
  const photos = await savePhotos(restaurantId, d.photos ?? []);
  return {
    google_place_id: d.id,
    address: d.formattedAddress ?? null,
    phone: d.internationalPhoneNumber ?? d.nationalPhoneNumber ?? null,
    ...(Object.keys(hours).length ? { opening_hours: hours } : {}),
    google_rating: d.rating ?? null,
    google_rating_count: d.userRatingCount ?? null,
    website: d.websiteUri ?? null,
    ...(d.primaryTypeDisplayName?.text ? { cuisine: d.primaryTypeDisplayName.text } : {}),
    ...(photos.length ? { photos } : {}),
  };
}
