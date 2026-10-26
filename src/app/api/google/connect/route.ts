import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { authUrl, oauthConfigured, signState } from "@/lib/google/oauth";

// "Connect Google": sends the logged-in person to Google's sign-in.
//   /api/google/connect?r=<restaurant id>          the owner's own Google login
//   /api/google/connect?as=manager                 DinerAI's manager account (builder only)
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const as = p.get("as") === "manager" ? "manager" : "owner";
  const rid = p.get("r") || null;
  const back = `/settings/google${rid ? `?r=${rid}` : ""}`;
  const owner = await currentOwner();
  if (!owner) return Response.redirect(new URL(`/login?next=${encodeURIComponent(back)}`, req.url), 303);
  if (!oauthConfigured()) return Response.redirect(new URL(`${back}${rid ? "&" : "?"}error=${encodeURIComponent("Google sign-in isn't set up yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY).")}`, req.url), 303);
  if (as === "manager" && !owner.isBuilder) return new Response("Not found", { status: 404 });
  if (as === "owner" && (!rid || !owner.restaurantIds.includes(rid))) return new Response("Not found", { status: 404 });
  const state = signState({ r: as === "owner" ? rid : null, as, email: owner.email, back });
  return Response.redirect(authUrl(state), 303);
}
