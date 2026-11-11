import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { approveSimple } from "@/lib/app/inbox";

// The Inbox's "Approve N simple items": replies to 4 or 5 star reviews and Google posts
// whose checks all passed (lib/app/cards.ts tierOf), each through the usual approval.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    return appJson(await approveSimple(id));
  });
}
