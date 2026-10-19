import "server-only";
import { getSupabase } from "@/lib/supabase";

// Pilot invite codes (table pilot_invites, managed by the builder in Supabase).
// A valid code lets a restaurant sign up without Stripe; the code is stored on
// the restaurant (restaurants.pilot_invite_code), which is what gives it access.

export function cleanInviteCode(raw: string | null | undefined) {
  const code = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{3,40}$/.test(code) ? code : null;
}

// Takes one use of the code, if it's active, not expired and has a use left.
export async function claimInvite(code: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("claim_pilot_invite", { p_code: code });
  if (error) {
    console.error("Couldn't check an invite code", error.message);
    return false;
  }
  return data === true;
}
