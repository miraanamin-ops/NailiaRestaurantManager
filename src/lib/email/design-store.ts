import "server-only";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { anotherLook, chooseDesign, designOf, familyOf, type CampaignLike, type EmailDesign } from "./designs";

// Saving each campaign's email design (campaigns.email_design, migration 071; the rules
// are in ./designs.ts). Never in the way of a campaign: before 071 has run, or if the
// save fails, the email still draws itself from a steady choice (designOf's fallback).

// The look this restaurant's last campaign of that family used.
async function lastLookOf(restaurantId: string, family: string, notId: string | null) {
  const rows =
    check(
      await getSupabase()
        .from("campaigns")
        .select("id, email_design")
        .eq("restaurant_id", restaurantId)
        .not("email_design", "is", null)
        .order("created_at", { ascending: false })
        .limit(30)
        .returns<{ id: string; email_design: EmailDesign | null }[]>(),
    ) ?? [];
  return rows.find((r) => r.id !== notId && r.email_design?.family === family)?.email_design?.look ?? null;
}

// A new campaign: its family, the next look in turn, the dish's photo if there is one.
export async function assignDesign(restaurant: Restaurant, campaign: CampaignLike): Promise<EmailDesign | null> {
  try {
    const family = familyOf(campaign);
    // A look that clearly does worse across all restaurants is passed over (lib/email/design-results.ts).
    const { lookToSkip } = await import("./design-results");
    const skip = await lookToSkip().catch(() => [] as string[]);
    const design = chooseDesign(campaign, await lastLookOf(restaurant.id, family, campaign.id), restaurant.menu, restaurant.photo_library, skip);
    check(await getSupabase().from("campaigns").update({ email_design: design }).eq("id", campaign.id).eq("restaurant_id", restaurant.id));
    return design;
  } catch (err) {
    console.warn("Couldn't save the email design (071 not run?)", err);
    return null;
  }
}

// After an edit: a new family (the words now say it's for Eid) gets that family's next
// look; otherwise the look and photo stay as they were.
export async function redesignAfterEdit(restaurant: Restaurant, campaign: CampaignLike) {
  if (campaign.email_design && familyOf(campaign) === campaign.email_design.family) return campaign.email_design;
  return assignDesign(restaurant, campaign);
}

// "Try another look" from the app: the next look in the same family, on a campaign
// still waiting for the owner. Null if there's no such campaign or nothing to change.
export async function tryAnotherLook(restaurantId: string, draftId: string): Promise<EmailDesign | null> {
  const campaign = check(
    await getSupabase().from("campaigns").select("*").eq("restaurant_id", restaurantId).eq("draft_id", draftId).maybeSingle<CampaignLike & { sent_at: string | null }>(),
  );
  if (!campaign || campaign.sent_at) return null;
  const next = anotherLook(designOf(campaign));
  check(await getSupabase().from("campaigns").update({ email_design: next }).eq("id", campaign.id).eq("restaurant_id", restaurantId));
  return next;
}
