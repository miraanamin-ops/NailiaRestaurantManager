import type { NextRequest } from "next/server";
import { appError, appJson, withOwner } from "@/lib/app-api";
import { billingStanding } from "@/lib/billing/access";
import { FOUNDER } from "@/lib/billing/config";
import { checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// FOUNDER in the Android app (step 50, phase 4). Google Play has no discount codes
// (its promo codes only give free time), so the app asks here first: a right code,
// one of the 50 places still free (founder_claims, 067), and this restaurant hasn't
// paid before. Then the app buys Google's "founder" offer (the free month, then 3
// months at £50). On iPhone FOUNDER is an Apple offer code, redeemed in Apple's own
// sheet, with its 50 uses set in App Store Connect; this isn't used there.
export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const body = (await req.json().catch(() => null)) as { r?: unknown; code?: unknown } | null;
    const id = typeof body?.r === "string" && owner.restaurantIds.includes(body.r) ? body.r : null;
    if (!id) return appError(404, "no_restaurant");
    const code = String(body?.code ?? "").trim().toUpperCase();
    if (code !== FOUNDER.code) return appJson({ ok: false, reason: "That code isn't one we know. Check the spelling, or carry on without it." });
    const db = getSupabase();
    const r = checkRow(await db.from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
    if (billingStanding(r).ok || r.store_status) return appJson({ ok: false, reason: "FOUNDER is for new restaurants starting their first month." });
    const mine = await db.from("founder_claims").select("restaurant_id").eq("restaurant_id", id).maybeSingle();
    if (!mine.data) {
      const { count } = await db.from("founder_claims").select("restaurant_id", { count: "exact", head: true });
      if ((count ?? 0) >= FOUNDER.maxUses) return appJson({ ok: false, reason: "Sorry, all 50 founder places have gone." });
      const claimed = await db.from("founder_claims").insert({ restaurant_id: id, platform: "play_store" });
      if (claimed.error && claimed.error.code !== "23505") throw new Error(claimed.error.message);
    }
    return appJson({ ok: true, offer: "founder" });
  });
}
