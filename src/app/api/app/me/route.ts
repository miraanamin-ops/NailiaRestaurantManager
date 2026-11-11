import type { NextRequest } from "next/server";
import { appJson, withOwner } from "@/lib/app-api";
import { appBilling, appStage } from "@/lib/app/stage";
import { check } from "@/lib/drafts";
import { isComplete, type Onboarding } from "@/lib/onboarding/store";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Who is logged in to the app and which restaurants they can see (the builder sees
// all), each with where it is: pay (start the free month), setup (Dina) or ready.
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const ids = owner.restaurantIds;
    const rows = ids.length
      ? (check(await getSupabase().from("restaurants").select("*").in("id", ids).order("created_at").returns<Restaurant[]>()) ?? [])
      : [];
    const setups = ids.length
      ? (check(await getSupabase().from("onboarding").select("restaurant_id, completed_at").in("restaurant_id", ids).returns<Pick<Onboarding, "restaurant_id" | "completed_at">[]>()) ?? [])
      : [];
    const setupOf = new Map(setups.map((o) => [o.restaurant_id, o]));
    const mine = rows.find((r) => r.owner_name) ?? rows[0];
    const firstName = (mine?.owner_name ?? "").trim().split(/\s+/)[0] || null;
    return appJson({
      email: owner.email,
      firstName: owner.isBuilder ? null : firstName,
      isBuilder: owner.isBuilder,
      restaurants: rows.map((r) => ({
        id: r.id,
        name: r.name,
        active: Boolean(r.active),
        stage: appStage(r, isComplete((setupOf.get(r.id) as Onboarding | undefined) ?? null)),
        billing: appBilling(r),
      })),
    });
  });
}
