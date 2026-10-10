import "server-only";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { isSandbox, ourWhatsAppNumber, sandboxJoinPhrase } from "@/lib/onboarding/channel";
import { normaliseWhatsApp, showNumber } from "@/lib/onboarding/steps";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Staff numbers: the owner registers them ("ADD STAFF +447..."), and they can
// send till report photos and sales files for that one restaurant. Nothing else.

export type StaffNumber = { id: string; restaurant_id: string; whatsapp: string; added_at: string; removed_at: string | null };

// Which restaurant a staff number sends data for (the webhook's look-up: staff are
// found by their number, the same way owners are).
export async function findStaff(whatsapp: string) {
  return check(
    await getSupabase()
      .from("staff_numbers")
      .select("id, restaurant_id, whatsapp")
      .eq("whatsapp", whatsapp)
      .is("removed_at", null)
      .maybeSingle<{ id: string; restaurant_id: string; whatsapp: string }>(),
  );
}

export async function listStaff(restaurantId: string) {
  return (
    check(
      await getSupabase()
        .from("staff_numbers")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .is("removed_at", null)
        .order("added_at")
        .returns<StaffNumber[]>(),
    ) ?? []
  );
}

function joinNote() {
  const phrase = sandboxJoinPhrase();
  const ours = showNumber(ourWhatsAppNumber());
  if (!isSandbox()) return `They just send their till report photo or sales file to ${ours}.`;
  return `First they need to send *${phrase ?? "the sandbox join phrase"}* to ${ours} on WhatsApp (once). Then they can send till report photos and sales files there.`;
}

export async function addStaff(r: Restaurant, raw: string) {
  const number = normaliseWhatsApp(raw);
  if (!number) return "❌ That doesn't look like a phone number. Try e.g. *ADD STAFF +447700900123*.";
  if (number === r.owner_whatsapp) return "That's your own number, so it can already send everything. 🙂";
  const supabase = getSupabase();
  const owner = check(await supabase.from("restaurants").select("id").eq("owner_whatsapp", number).maybeSingle<{ id: string }>());
  if (owner) return `❌ ${showNumber(number)} is a restaurant owner's number, so it can't be added as staff.`;
  const existing = await findStaff(number);
  if (existing?.restaurant_id === r.id) return `${showNumber(number)} is already on your staff list. ✅`;
  if (existing) return `❌ ${showNumber(number)} is already staff for another restaurant. They'd need to be removed there first.`;
  check(await supabase.from("staff_numbers").insert({ restaurant_id: r.id, whatsapp: number }));
  await logAction({ restaurantId: r.id, actor: "owner", action: "staff_added", detail: `Added ${showNumber(number)} as staff`, data: { number } });
  return `👥 Added *${showNumber(number)}* as staff. They can send till report photos and sales files, and nothing else.\n${joinNote()}\n(REMOVE STAFF ${showNumber(number).replace(/\s/g, "")} takes them off.)`;
}

export async function removeStaff(r: Restaurant, raw: string) {
  const number = normaliseWhatsApp(raw);
  if (!number) return "❌ That doesn't look like a phone number. Try e.g. *REMOVE STAFF +447700900123*.";
  const existing = await findStaff(number);
  if (!existing || existing.restaurant_id !== r.id) return `${showNumber(number)} isn't on your staff list. (Text STAFF to see who is.)`;
  check(await getSupabase().from("staff_numbers").update({ removed_at: new Date().toISOString() }).eq("id", existing.id).eq("restaurant_id", r.id));
  await logAction({ restaurantId: r.id, actor: "owner", action: "staff_removed", detail: `Removed ${showNumber(number)} from staff`, data: { number } });
  return `👥 Removed *${showNumber(number)}*. They can't send anything any more.`;
}

export async function staffText(r: Restaurant) {
  const staff = await listStaff(r.id);
  if (!staff.length) return "👥 No staff numbers yet. Add one with *ADD STAFF +447700900123*: they'll be able to send till report photos and sales files, nothing else.";
  return `👥 *Staff numbers* (can send till reports and sales files only)\n${staff.map((s) => `- ${showNumber(s.whatsapp)}`).join("\n")}\n\nADD STAFF / REMOVE STAFF + a number to change it.`;
}

// UNDO of ADD STAFF / REMOVE STAFF.
export async function setStaffActive(restaurantId: string, number: string, active: boolean) {
  const supabase = getSupabase();
  if (!active) {
    check(await supabase.from("staff_numbers").update({ removed_at: new Date().toISOString() }).eq("restaurant_id", restaurantId).eq("whatsapp", number).is("removed_at", null));
    return true;
  }
  if (await findStaff(number)) return false; // someone has added it since
  check(await supabase.from("staff_numbers").insert({ restaurant_id: restaurantId, whatsapp: number }));
  return true;
}
