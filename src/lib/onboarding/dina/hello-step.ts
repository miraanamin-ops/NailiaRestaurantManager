import "server-only";
import type { Restaurant } from "@/lib/supabase";
import { stepState, type FlowState } from "../flow";
import { placesAvailable, searchPlaces } from "../places";
import { noteStep } from "../sessions";
import type { DataBlock } from "./prompt";

// Step 1's pre-fill: when we don't have the address yet, Google Maps is searched
// for the restaurant's name (once; the matches are kept on the step) and Dina gets
// the matches as data, so she can ask "Is this you?" instead of asking them to
// type it. Needs GOOGLE_PLACES_API_KEY; without it she simply asks.

type Match = { name: string; address: string };

export async function helloPlacesData(restaurant: Pick<Restaurant, "id" | "name" | "address">, state: FlowState): Promise<DataBlock | null> {
  if (!placesAvailable() || restaurant.address?.trim() || !restaurant.name?.trim()) return null;
  let matches = stepState(state, "hello").data.places as Match[] | undefined;
  if (!matches) {
    matches = await searchPlaces(restaurant.name)
      .then((found) => found.map((p) => ({ name: p.name, address: p.address })).filter((p) => p.address))
      .catch((err) => (console.warn("Google Maps search for the hello step failed", err), []));
    await noteStep(restaurant.id, "hello", { places: matches });
  }
  if (!matches.length) return null;
  return {
    source: "places",
    label: "Google Maps matches for the restaurant's name (possible, not confirmed: ask which, if any, is theirs)",
    text: matches.map((m, i) => `${i + 1}. ${m.name}, ${m.address}`).join("\n"),
  };
}
