import "server-only";
import { getSupabase } from "@/lib/supabase";
import { emailHash } from "./rules";

// Addresses never to add or email again (email_suppressions, 064), kept as a hash:
// per restaurant (unsubscribed, deleted their data) or everywhere (a hard bounce).
// Never throws: a missing suppression must not stop an unsubscribe or a deletion.

export async function suppress(restaurantId: string | null, email: string | null | undefined, reason: "unsubscribed" | "deleted" | "hard_bounce") {
  if (!email?.includes("@")) return;
  const res = await getSupabase()
    .from("email_suppressions")
    .insert({ restaurant_id: restaurantId, email_hash: emailHash(email), reason })
    .then((r) => r, (err: unknown) => ({ error: { message: String(err), code: "" } }));
  // 23505: already suppressed.
  if (res.error && (res.error as { code?: string }).code !== "23505") console.error("Couldn't add an address to the suppression list", res.error.message);
}

// The hashes suppressed for this restaurant (its own, and hard bounces everywhere).
export async function suppressedHashes(restaurantId: string) {
  const res = await getSupabase()
    .from("email_suppressions")
    .select("email_hash, restaurant_id")
    .or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
    .limit(100_000)
    .returns<{ email_hash: string }[]>();
  if (res.error) throw new Error(res.error.message);
  return new Set((res.data ?? []).map((r) => r.email_hash));
}
