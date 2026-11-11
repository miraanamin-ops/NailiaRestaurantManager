import type { NextRequest } from "next/server";
import { appError, appJson, ownedRestaurant, withOwner } from "@/lib/app-api";
import { referralFor } from "@/lib/app/more";

// More > Recommend a restaurant: the restaurant's referral code (made the first
// time it's asked for) and its link, for the phone's Share sheet.
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const r = await ownedRestaurant(owner, req.nextUrl.searchParams.get("r"));
    if (!r) return appError(404, "no_restaurant");
    return appJson(await referralFor(r));
  });
}
