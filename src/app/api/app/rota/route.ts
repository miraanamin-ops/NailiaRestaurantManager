import type { NextRequest } from "next/server";
import { appError, appJson, ownedRestaurant, withOwner } from "@/lib/app-api";
import { rotaWeeksFor } from "@/lib/app/rota";

// Reports > Rota: this week's and next week's rota (who works when, hours, cost and
// labour %), whether it's approved or waiting in the Inbox, and the team's link.
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const r = await ownedRestaurant(owner, req.nextUrl.searchParams.get("r"));
    if (!r) return appError(404, "no_restaurant");
    return appJson(await rotaWeeksFor(r));
  });
}
