import "server-only";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { saveProfileFields, type EditableFields } from "@/lib/profile-edits";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import * as api from "./api";
import { linkFor } from "./connections";
import { syncReviews } from "./live";
import { importFromLocation, prefillFromImport, type GoogleImport } from "./mapping";

// Import on connect: the location's address, phone, website, hours, special
// hours, categories, photos and its last 50 reviews. The snapshot is kept on
// the restaurant (google_import), and only EMPTY profile fields are filled from
// it, so nothing the owner already set is overwritten. Onboarding reads the
// snapshot through googlePrefill() to prefill its Google step.

export async function importFromGoogle(restaurantId: string, actor: "owner" | "builder" = "owner") {
  const link = await linkFor(restaurantId);
  if (!link) throw new Error("This restaurant isn't connected to Google");
  const [location, media] = await Promise.all([api.getLocation(link), api.listMedia(link, 20).catch(() => [])]);
  const reviews = await syncReviews(link, { max: 50, firstTime: !link.restaurant.google_imported_at });
  const snapshot = importFromLocation(location, media, { count: reviews.count, queued: reviews.queued });

  const supabase = getSupabase();
  check(await supabase.from("restaurants").update({ google_import: snapshot, google_imported_at: new Date().toISOString() }).eq("id", restaurantId));

  const filled = await fillGaps(link.restaurant, snapshot);
  await logAction({
    restaurantId,
    actor,
    action: "google",
    detail: `Imported from Google: ${snapshot.title ?? location.name}, ${reviews.count} reviews (${reviews.queued} waiting for a reply)${filled.length ? `; filled in ${filled.join(", ")}` : ""}`,
  });
  return { snapshot, filled };
}

// Fills only the restaurant's empty fields from an import. Editable details go
// through saveProfileFields (logged, so UNDO can put them back).
async function fillGaps(restaurant: Restaurant, snapshot: GoogleImport) {
  const want = prefillFromImport(restaurant, snapshot);
  const { photos, google_place_id, cuisine, ...editable } = want;
  const names = Object.keys(editable).length ? await saveProfileFields(restaurant, editable as Partial<EditableFields>, "Filled in from Google") : [];
  const plain: Record<string, unknown> = {};
  if (photos) plain.photos = photos;
  if (google_place_id) plain.google_place_id = google_place_id;
  if (cuisine) plain.cuisine = cuisine;
  if (Object.keys(plain).length) check(await getSupabase().from("restaurants").update(plain).eq("id", restaurant.id));
  return [...names, ...Object.keys(plain).map((k) => k.replace(/_/g, " "))];
}

// For onboarding: what the Google import would fill in on this restaurant
// (empty fields only), or null if Google isn't connected or imported yet.
export async function googlePrefill(restaurantId: string) {
  const r = check(await getSupabase().from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Restaurant>());
  if (!r?.google_import) return null;
  return { snapshot: r.google_import, fill: prefillFromImport(r, r.google_import) };
}
