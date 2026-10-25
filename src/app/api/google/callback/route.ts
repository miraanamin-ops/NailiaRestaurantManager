import type { NextRequest } from "next/server";
import { logAction } from "@/lib/audit";
import { currentOwner } from "@/lib/auth";
import { saveConnection } from "@/lib/google/connections";
import { exchangeCode, idTokenIdentity, readState } from "@/lib/google/oauth";

// Google sends the person back here after they sign in (the redirect URI set in
// Google Cloud: https://app.dinerai.co.uk/api/google/callback). Only accepted
// for a login our own page started (signed state) by the same person, still
// logged in. Then they pick their location on /settings/google.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const state = readState(p.get("state"));
  const fail = (back: string, why: string) => Response.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(why)}`, req.url), 303);
  if (!state) return fail("/settings/google", "That Google sign-in link had expired. Please try Connect Google again.");
  if (p.get("error")) return fail(state.back, p.get("error") === "access_denied" ? "Google sign-in was cancelled. Nothing was connected." : `Google said: ${p.get("error")}`);

  const owner = await currentOwner();
  if (!owner || owner.email !== state.email) return fail(state.back, "Please log in to DinerAI with the same email, then connect Google again.");
  if (state.as === "manager" ? !owner.isBuilder : !state.r || !owner.restaurantIds.includes(state.r)) return new Response("Not found", { status: 404 });

  try {
    const tokens = await exchangeCode(p.get("code") ?? "");
    if (!tokens.scope?.includes("business.manage")) return fail(state.back, "Google didn't give permission to manage your Business Profile. Connect again and tick the box for it.");
    const who = idTokenIdentity(tokens.id_token);
    if (!who) return fail(state.back, "Google didn't say which account signed in. Please try again.");
    const connectionId = await saveConnection({ restaurantId: state.r, kind: state.as, sub: who.sub, email: who.email, tokens, connectedBy: owner.email });
    await logAction({
      restaurantId: state.r,
      actor: owner.isBuilder ? "builder" : "owner",
      action: "google",
      detail: `Signed in to Google as ${who.email ?? "a Google account"}${state.as === "manager" ? " (DinerAI's manager account)" : ""}`,
    });
    const q = new URLSearchParams({ pick: connectionId });
    if (state.r) q.set("r", state.r);
    return Response.redirect(new URL(`/settings/google?${q}`, req.url), 303);
  } catch (err) {
    console.error("Google sign-in failed", err);
    return fail(state.back, err instanceof Error ? err.message : "Google sign-in failed");
  }
}
