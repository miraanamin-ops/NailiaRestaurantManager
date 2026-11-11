import type { NextRequest } from "next/server";
import { appError, appJson, ownedRestaurant, withOwner } from "@/lib/app-api";
import { exportLink } from "@/lib/app/more";

// More > Customers > Export: the same signed one-hour download page as EXPORT
// CUSTOMERS on WhatsApp. The download itself is what's logged (one export, one line).
export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const r = await ownedRestaurant(owner, req.nextUrl.searchParams.get("r"));
    if (!r) return appError(404, "no_restaurant");
    return appJson({ url: exportLink(r) });
  });
}
