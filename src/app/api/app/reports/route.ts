import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { reportList } from "@/lib/app/more";

// The Reports tab: the weekly and monthly reports, newest first.
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    return appJson({ restaurantId: id, reports: await reportList(id) });
  });
}
