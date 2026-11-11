import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { paysThroughStore } from "@/lib/billing/access";
import { canSkipCoolingOff } from "@/lib/closure-rules";
import { cancelClosure, ClosureError, confirmClosure, openClosureFor, requestClosure } from "@/lib/closure";
import { checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Delete account in the app (Apple's rule), through the website's close-account flow
// (lib/closure.ts): typing the restaurant's name confirms it, sending pauses at once,
// and after 24 hours to change their mind everything is exported for them, then
// deleted (Google access removed, Stripe cancelled, the login deleted). Demo and test
// restaurants close straight away; the demo pair never closes.
//   GET ?r=    a closure in progress, if any: { closing: { closesAt } | null }
//   POST       { r, typedName }        ask and confirm in one go
//   DELETE ?r= cancel during the 24 hours
// An App Store / Google Play subscription can only be cancelled by the owner in the
// store: the answer says so (storeNote).
async function load(id: string) {
  return checkRow(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
}

const STORE_NOTE = "Your App Store or Google Play subscription isn't cancelled by this: cancel it in your phone's Settings (App Store: your name > Subscriptions; Google Play: Payments & subscriptions), or you'll still be charged.";

export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    const c = await openClosureFor(id);
    return appJson({ closing: c ? { closesAt: c.closes_at, status: c.status } : null });
  });
}

export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const body = (await req.json().catch(() => null)) as { r?: unknown; typedName?: unknown } | null;
    const id = restaurantFor(owner, typeof body?.r === "string" ? body.r : null);
    if (!id) return appError(404, "no_restaurant");
    const r = await load(id);
    // The builder sees every restaurant: from the app they can only close a test one.
    if (owner.isBuilder && !canSkipCoolingOff(r)) return appError(403, "builder_real");
    const typed = typeof body?.typedName === "string" ? body.typedName.slice(0, 120) : "";
    try {
      const c = await requestClosure(r.id, typed, owner.email, "owner");
      const { closesAt } = await confirmClosure({ closureId: c.id, typedName: typed, understood: true, skipCoolingOff: canSkipCoolingOff(r), builderEmail: owner.email, by: "owner" });
      return appJson({ closesAt: closesAt.toISOString(), now: canSkipCoolingOff(r), storeNote: paysThroughStore(r) ? STORE_NOTE : null });
    } catch (err) {
      if (err instanceof ClosureError) return appJson({ refused: err.message });
      throw err;
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    const c = await openClosureFor(id);
    if (!c) return appJson({ cancelled: false });
    try {
      await cancelClosure(c.id, owner.email, "owner");
      return appJson({ cancelled: true });
    } catch (err) {
      if (err instanceof ClosureError) return appJson({ refused: err.message });
      throw err;
    }
  });
}
