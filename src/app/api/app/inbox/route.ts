import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { inboxCards } from "@/lib/app/inbox";

// Every draft waiting for the owner, as cards: urgent first, then flagged, then oldest.
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    return appJson({ restaurantId: id, cards: await inboxCards(id) });
  });
}
