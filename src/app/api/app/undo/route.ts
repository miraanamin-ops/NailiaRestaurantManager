import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { undoFromApp } from "@/lib/app/inbox";
import { checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// UNDO, as on WhatsApp: reverses the owner's last approval, skip, edit or setting
// change where possible (an email already sent can't be taken back).
export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    const r = checkRow(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
    return appJson({ message: await undoFromApp(r) });
  });
}
