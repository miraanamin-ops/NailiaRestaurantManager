import type { NextRequest } from "next/server";
import { appError, appJson, ownedRestaurant, withOwner } from "@/lib/app-api";
import { customersFor } from "@/lib/app/more";

// More > Customers: the counts, the list (50 at a time, ?q= searches name or email,
// ?page=), the sign-up link with its QR code, and the printable QR pack.
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const r = await ownedRestaurant(owner, req.nextUrl.searchParams.get("r"));
    if (!r) return appError(404, "no_restaurant");
    const page = Math.max(0, Math.min(1000, Number(req.nextUrl.searchParams.get("page")) || 0));
    return appJson(await customersFor(r, req.nextUrl.searchParams.get("q") ?? "", page));
  });
}
