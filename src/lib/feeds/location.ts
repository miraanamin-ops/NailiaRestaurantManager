import "server-only";
import { check } from "@/lib/drafts";
import { postcodeOf, townOf } from "@/lib/sales/weather-data";
import { getSupabase } from "@/lib/supabase";
import { getJson } from "./http";
import { COMPUTED_METHOD } from "./prayer";
import { cellOf } from "./weather-data";

// Where a restaurant is, and what follows from it: its weather cell, its
// council (school holidays) and nation (bank holidays), from postcodes.io
// (free, no key), else the town from Open-Meteo's place search. Saved on the
// restaurant once; changing the address clears it (see onAddressChanged).

export type Located = { lat: number; lon: number; cell: string; councilCode: string | null };

type LocRestaurant = {
  id: string;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  council_code?: string | null;
  council_name?: string | null;
  nation?: string | null;
  weather_cell?: string | null;
  prayer_method?: string | null;
};

type Postcode = { result?: { latitude: number; longitude: number; country?: string; admin_district?: string; codes?: { admin_district?: string } } };

const NATIONS: Record<string, string> = { England: "england", Wales: "wales", Scotland: "scotland", "Northern Ireland": "northern_ireland" };

// What postcodes.io tells us, as restaurant columns (pure, unit-tested).
export function fromPostcode(json: Postcode) {
  const r = json.result;
  if (!r) return null;
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    council_code: r.codes?.admin_district ?? null,
    council_name: r.admin_district ?? null,
    nation: r.country ? (NATIONS[r.country] ?? null) : null,
  };
}

export async function ensureLocated(r: LocRestaurant): Promise<Located | null> {
  const patch: Record<string, unknown> = {};
  let lat = r.latitude != null ? Number(r.latitude) : null;
  let lon = r.longitude != null ? Number(r.longitude) : null;
  const postcode = postcodeOf(r.address);
  // The postcode also gives the council, so it's asked even when the position is known.
  if (postcode && (lat === null || !r.council_code)) {
    try {
      const p = fromPostcode(await getJson<Postcode>(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, { cacheKey: `postcode:${postcode}`, maxAgeMs: 90 * 86_400_000 }));
      if (p) {
        if (lat === null || lon === null) {
          lat = p.latitude;
          lon = p.longitude;
          patch.latitude = lat;
          patch.longitude = lon;
        }
        if (!r.council_code && p.council_code) Object.assign(patch, { council_code: p.council_code, council_name: p.council_name });
        if (!r.nation && p.nation) patch.nation = p.nation;
      }
    } catch (err) {
      console.warn("Postcode look-up failed; trying the town", err);
    }
  }
  const town = townOf(r.address);
  if ((lat === null || lon === null) && town) {
    const out = await getJson<{ results?: { latitude: number; longitude: number }[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: town, count: "1", countryCode: "GB" })}`,
    );
    if (out.results?.[0]) {
      lat = out.results[0].latitude;
      lon = out.results[0].longitude;
      patch.latitude = lat;
      patch.longitude = lon;
    }
  }
  if (lat === null || lon === null) return null;
  const cell = cellOf(lat, lon);
  if (r.weather_cell !== cell) patch.weather_cell = cell;
  if (!r.prayer_method) patch.prayer_method = COMPUTED_METHOD;
  if (Object.keys(patch).length) check(await getSupabase().from("restaurants").update(patch).eq("id", r.id));
  return { lat, lon, cell, councilCode: (patch.council_code as string | undefined) ?? r.council_code ?? null };
}
