import "server-only";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { messageOwner } from "@/lib/notify";
import { findStaff } from "@/lib/sales/staff";
import { getSupabase } from "@/lib/supabase";
import { replyUnregistered } from "@/lib/unregistered";
import { startOnboarding } from "./sessions";
import { showNumber } from "./steps";

// Linking the owner's WhatsApp to a Dina sign-up. The number typed on the sign-up
// form is linked by the first message it sends us (WhatsApp itself proves the
// number, and the webhook has checked Twilio's signature), unless that number
// already belongs to someone: another restaurant's owner, or a staff number.
// Then it's never linked automatically: the owner is told why and sends the
// one-time code ("Link my restaurant: CODE") instead, as before.

export type WhatsAppConflict = "owner" | "staff" | null;

// Is this number already someone's, other than this restaurant's owner?
export async function whatsappConflict(number: string | null, restaurantId: string): Promise<WhatsAppConflict> {
  if (!number) return null;
  // (owner_whatsapp is unique: at most one restaurant has it.)
  const owner = check(await getSupabase().from("restaurants").select("id").eq("owner_whatsapp", number).maybeSingle<{ id: string }>());
  if (owner && owner.id !== restaurantId) return "owner";
  return (await findStaff(number)) ? "staff" : null;
}

export const CONFLICT_REASON: Record<Exclude<WhatsAppConflict, null>, string> = {
  owner: "is already linked to another restaurant on DinerAI",
  staff: "is already a staff number for another restaurant on DinerAI",
};

// Dina sign-ups still setting up that gave this number and have no WhatsApp yet.
// (Only for numbers that aren't an owner's or a staff number: the webhook checks those first.)
export async function pendingSignupsFor(number: string): Promise<string[]> {
  const supabase = getSupabase();
  const pending = check(await supabase.from("onboarding").select("restaurant_id").eq("pending_whatsapp", number).is("completed_at", null).returns<{ restaurant_id: string }[]>()) ?? [];
  if (!pending.length) return [];
  const ids = pending.map((p) => p.restaurant_id);
  const [sessions, restaurants] = await Promise.all([
    supabase.from("onboarding_sessions").select("restaurant_id").in("restaurant_id", ids).is("completed_at", null).returns<{ restaurant_id: string }[]>(),
    supabase.from("restaurants").select("id").in("id", ids).is("owner_whatsapp", null).returns<{ id: string }[]>(),
  ]);
  const dina = new Set((check(sessions) ?? []).map((s) => s.restaurant_id));
  return (check(restaurants) ?? []).map((r) => r.id).filter((id) => dina.has(id));
}

const TOO_MANY = "This number was given for more than one restaurant being set up, so I can't tell which to link. Open your setup page and send the code shown there. 🙏";
const TAKEN = "This WhatsApp number is already linked to another restaurant on DinerAI, so I can't link it to this one. Open your setup page and send the code shown there from the phone you want to use. 🙏";

// The first message from a sign-up's number: link it, then carry on setting up here.
export async function linkSignupNumber(number: string, ourNumber: string, restaurantIds: string[]) {
  try {
    if (restaurantIds.length !== 1) return await replyUnregistered(number, ourNumber, TOO_MANY, 3);
    const restaurantId = restaurantIds[0];
    // Only if it still has no number (two messages at once link it once), and the
    // database refuses a number another restaurant has (unique).
    const { data, error } = await getSupabase()
      .from("restaurants")
      .update({ owner_whatsapp: number, whatsapp_from: ourNumber })
      .eq("id", restaurantId)
      .is("owner_whatsapp", null)
      .select("id, name")
      .maybeSingle<{ id: string; name: string }>();
    if (error?.code === "23505") return await replyUnregistered(number, ourNumber, TAKEN, 3);
    if (error) throw new Error(error.message);
    if (!data) return; // already linked by the other message
    check(await getSupabase().from("onboarding").update({ link_code: null, link_code_expires_at: null }).eq("restaurant_id", restaurantId));
    await startOnboarding(restaurantId, { channel: "whatsapp" });
    await logAction({ restaurantId, actor: "owner", action: "setting", detail: `Linked WhatsApp ${showNumber(number)} (the number given at sign-up)` });
    // Dina takes it from here: hello, or carrying on at the step they reached on the web.
    try {
      const { greetOnWhatsApp } = await import("./dina/whatsapp-turn");
      await greetOnWhatsApp(restaurantId, number, ourNumber);
    } catch (err) {
      console.error("Dina couldn't greet a newly linked number", err);
      await messageOwner(
        { restaurantId, from: ourNumber, to: number },
        `✅ Linked! This WhatsApp is now connected to *${data.name}*. We'll carry on setting up here, or on the web whenever you like.`,
      );
    }
  } catch (err) {
    console.error("Linking a sign-up's WhatsApp number failed", err);
  }
}
