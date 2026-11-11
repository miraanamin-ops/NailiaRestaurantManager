import type { NextRequest } from "next/server";
import { appError, appJson, ownedRestaurant, withOwner } from "@/lib/app-api";
import { restaurantNow } from "@/lib/supabase";
import { pauseSending, resumeSending } from "@/lib/pause";

// Pause / Resume all sending, as PAUSE and RESUME on WhatsApp (lib/pause.ts).
// { paused: true | false } → { paused, released }: how many held messages went out.
export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const r = await ownedRestaurant(owner, req.nextUrl.searchParams.get("r"));
    if (!r) return appError(404, "no_restaurant");
    const body = (await req.json().catch(() => null)) as { paused?: unknown } | null;
    if (typeof body?.paused !== "boolean") return appError(400, "bad_pause");
    if (body.paused) {
      await pauseSending(r);
      return appJson({ paused: true, released: 0 });
    }
    const { released } = await resumeSending(r, restaurantNow(r));
    return appJson({ paused: false, released: released.length });
  });
}
