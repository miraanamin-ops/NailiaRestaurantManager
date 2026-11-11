import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { todayFor } from "@/lib/app/inbox";
import { checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Today: yesterday's takings, what's waiting, and what was done for the owner.
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    const r = checkRow(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
    return appJson(await todayFor(r));
  });
}
