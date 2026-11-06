import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { readState } from "@/lib/google/oauth";
import { lightspeedExchange, lightspeedLocations, squareExchange, squareLocations, squareMerchantName } from "@/lib/tills/clients";
import { queueTillSync } from "@/lib/tills/actions";
import { tillPlaceName } from "@/lib/tills/rules";
import { saveTill } from "@/lib/tills/store";

// Square or Lightspeed sends the owner back here after they sign in (the
// redirect URL set in each developer console:
// https://app.dinerai.co.uk/api/till/square/callback and .../lightspeed/callback).
// Only accepted for a sign-in our own page started (signed state), by the same
// person, still logged in. One location is picked straight away; with several,
// the owner picks on /settings/till.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/till/[provider]/callback">) {
  const { provider } = await ctx.params;
  if (provider !== "square" && provider !== "lightspeed") return new Response("Not found", { status: 404 });
  const p = req.nextUrl.searchParams;
  const state = readState(p.get("state"));
  const fail = (back: string, why: string) => Response.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(why)}`, req.url), 303);
  if (!state || !state.r) return fail("/settings", "That sign-in link had expired. Please tap Connect again.");
  if (p.get("error")) return fail(state.back, p.get("error") === "access_denied" ? "Sign-in was cancelled. Nothing was connected." : `The till said: ${p.get("error")}`);

  const owner = await currentOwner();
  if (!owner || owner.email !== state.email) return fail(state.back, "Please log in to DinerAI with the same email, then connect again.");
  if (!owner.restaurantIds.includes(state.r)) return new Response("Not found", { status: 404 });

  try {
    const code = p.get("code") ?? "";
    const tokens = provider === "square" ? await squareExchange(code) : await lightspeedExchange(code);
    const locations = provider === "square" ? await squareLocations(tokens.access_token) : await lightspeedLocations(tokens.access_token);
    const account = provider === "square" ? tokens.account : ((locations[0] as { business?: string | null } | undefined)?.business ?? null);
    const only = locations.length === 1 ? locations[0] : null;
    const merchant = provider === "square" ? await squareMerchantName(tokens.access_token).catch(() => null) : null;
    const c = await saveTill({
      restaurantId: state.r,
      provider,
      mode: "live",
      credentials: { kind: "oauth", access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: tokens.expires_at },
      account,
      location: only?.id ?? null,
      locationName: only ? tillPlaceName(merchant, only.name) : merchant,
      connectedBy: owner.email,
      actor: owner.isBuilder ? "builder" : "owner",
    });
    if (only) await queueTillSync(state.r, c.id);
    const r = new URLSearchParams({ r: state.r, saved: only ? "connected" : "pick" });
    if (!locations.length) r.set("error", "Connected, but we couldn't see any locations on that account.");
    return Response.redirect(new URL(`/settings/till?${r}`, req.url), 303);
  } catch (err) {
    console.error(`${provider} sign-in failed`, err);
    return fail(state.back, err instanceof Error ? err.message : "Sign-in failed");
  }
}
