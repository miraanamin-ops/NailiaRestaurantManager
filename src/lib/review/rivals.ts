import "server-only";
import { check } from "@/lib/drafts";
import { places, placesAvailable, searchPlaces } from "@/lib/onboarding/places";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { RIVALS } from "./config";
import { nearbyAverage } from "./rules";

// You vs nearby rivals (Places API, new): the closest restaurants with the same
// primary category within a mile, their rating and review count against ours.
// Places terms: only their place ids are stored (rival_places); everything else
// is fetched fresh when it's shown (the review page shows Google's attribution).
// We never show rivals' reply rates (Places doesn't have them).
//
// Test and demo sites never call Google: their Places answers come from the
// dummy profile's `places` (or the default below), so tests cost nothing.

export type PlaceRating = { id: string; name: string; rating: number | null; count: number | null };
type Center = { latitude: number; longitude: number };
type Ours = { id: string; location: Center | null; primaryType: string | null; rating: number | null; count: number | null };

export type PlacesFixture = { ours?: { rating: number; count: number } | null; rivals: PlaceRating[] };
export const DEFAULT_FIXTURE: PlacesFixture = {
  ours: { rating: 4.4, count: 132 },
  rivals: [
    { id: "fixture-rival-1", name: "Charcoal House", rating: 4.5, count: 410 },
    { id: "fixture-rival-2", name: "Whitechapel Kebabs", rating: 4.1, count: 220 },
    { id: "fixture-rival-3", name: "Brick Lane Grill", rating: 4.3, count: 980 },
    { id: "fixture-rival-4", name: "Lahori Nights", rating: 3.9, count: 156 },
    { id: "fixture-rival-5", name: "Aldgate Shawarma", rating: 4.2, count: 75 },
  ],
};

const usesFixtures = (r: Pick<Restaurant, "is_demo" | "is_test">) => Boolean(r.is_demo || r.is_test);
const fixtureFor = (r: Pick<Restaurant, "dummy_google_profile">) => ((r.dummy_google_profile as { places?: PlacesFixture } | null)?.places ?? DEFAULT_FIXTURE);

async function ourPlace(r: Restaurant): Promise<Ours | null> {
  let id = r.google_place_id ?? null;
  if (!id) {
    const found = await searchPlaces([r.name, r.address].filter(Boolean).join(", "));
    id = found[0]?.id ?? null;
  }
  if (!id) return null;
  const d = await places<{ id: string; location?: Center; primaryType?: string; rating?: number; userRatingCount?: number }>(`/places/${encodeURIComponent(id)}`, {
    method: "GET",
    fieldMask: "id,location,primaryType,rating,userRatingCount",
  });
  return { id: d.id, location: d.location ?? null, primaryType: d.primaryType ?? null, rating: d.rating ?? null, count: d.userRatingCount ?? null };
}

async function nearby(ours: Ours): Promise<PlaceRating[]> {
  if (!ours.location || !ours.primaryType) return [];
  const out = await places<{ places?: { id: string; displayName?: { text: string }; rating?: number; userRatingCount?: number }[] }>("/places:searchNearby", {
    method: "POST",
    body: JSON.stringify({
      includedPrimaryTypes: [ours.primaryType],
      maxResultCount: RIVALS.count + 1,
      rankPreference: "DISTANCE",
      locationRestriction: { circle: { center: ours.location, radius: RIVALS.radiusMetres } },
    }),
    fieldMask: "places.id,places.displayName,places.rating,places.userRatingCount",
  });
  return (out.places ?? [])
    .filter((p) => p.id !== ours.id)
    .slice(0, RIVALS.count)
    .map((p) => ({ id: p.id, name: p.displayName?.text ?? "A restaurant nearby", rating: p.rating ?? null, count: p.userRatingCount ?? null }));
}

// Finds the rivals now, saves their ids (nothing else), and returns what the message needs.
export async function findRivals(r: Restaurant) {
  let ours: { rating: number; count: number } | null;
  let rivals: PlaceRating[];
  if (usesFixtures(r)) {
    const f = fixtureFor(r);
    ours = f.ours ?? null;
    rivals = f.rivals.slice(0, RIVALS.count);
  } else {
    if (!placesAvailable()) throw new Error("GOOGLE_PLACES_API_KEY isn't set, so rivals can't be found");
    const me = await ourPlace(r);
    if (!me) throw new Error("Couldn't find the restaurant on Google Maps");
    ours = me.rating !== null && me.count ? { rating: me.rating, count: me.count } : null;
    rivals = await nearby(me);
  }
  check(await getSupabase().from("rival_places").delete().eq("restaurant_id", r.id));
  if (rivals.length) check(await getSupabase().from("rival_places").insert(rivals.map((x, i) => ({ restaurant_id: r.id, place_id: x.id, rank: i + 1 }))));
  return { ours, nearby: nearbyAverage(rivals) };
}

// For the review page: the stored ids, fetched fresh (names, ratings, counts).
export async function rivalsNow(r: Restaurant): Promise<PlaceRating[]> {
  const ids = ((check(await getSupabase().from("rival_places").select("place_id, rank").eq("restaurant_id", r.id).order("rank")) ?? []) as { place_id: string }[]).map((x) => x.place_id);
  if (!ids.length) return [];
  if (usesFixtures(r)) {
    const f = fixtureFor(r);
    return ids.map((id) => f.rivals.find((x) => x.id === id)).filter(Boolean) as PlaceRating[];
  }
  if (!placesAvailable()) return [];
  const out: PlaceRating[] = [];
  for (const id of ids) {
    try {
      const d = await places<{ id: string; displayName?: { text: string }; rating?: number; userRatingCount?: number }>(`/places/${encodeURIComponent(id)}`, { method: "GET", fieldMask: "id,displayName,rating,userRatingCount" });
      out.push({ id: d.id, name: d.displayName?.text ?? "A restaurant nearby", rating: d.rating ?? null, count: d.userRatingCount ?? null });
    } catch (err) {
      console.error("Couldn't fetch a rival's details", err);
    }
  }
  return out;
}
