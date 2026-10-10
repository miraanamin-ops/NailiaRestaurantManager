import "server-only";
import { redirect } from "next/navigation";
import { currentOwner, pickRestaurantId, requireOwner } from "@/lib/auth";
import { state } from "@/lib/onboarding/engine";
import { refreshLinkCode } from "@/lib/onboarding/store";

type Query = Record<string, string | string[] | undefined>;
export const one = (q: Query, k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);

// For the onboarding pages: the logged-in owner and the restaurant they're setting up.
export async function loadOnboarding(searchParams: Promise<Query>, path: string) {
  const q = await searchParams;
  const want = one(q, "r");
  const owner = await requireOwner(`${path}${want ? `?r=${want}` : ""}`);
  const restaurantId = pickRestaurantId(owner, want);
  if (!restaurantId) redirect("/");
  const s = await state(restaurantId).catch(() => null);
  if (!s) redirect(`/?r=${restaurantId}`); // set up before onboarding existed
  return { owner, q, restaurantId, s };
}

// The one-time code for linking WhatsApp, renewed if it has expired.
export async function linkCodeFor(restaurantId: string, onboarding: { link_code: string | null; link_code_expires_at: string | null }) {
  const expired = !onboarding.link_code || (onboarding.link_code_expires_at && new Date(onboarding.link_code_expires_at) < new Date());
  return expired ? (await refreshLinkCode(restaurantId)).link_code! : onboarding.link_code!;
}

// For the onboarding actions: only the restaurant's own owner (or the builder).
export async function ownRestaurant(restaurantId: string) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(`/onboarding/setup?r=${restaurantId}`)}`);
  if (!owner.restaurantIds.includes(restaurantId)) throw new Error("Not your restaurant");
  return owner;
}
