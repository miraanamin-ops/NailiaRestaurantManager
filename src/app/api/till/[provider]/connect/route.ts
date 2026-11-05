import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { signState } from "@/lib/google/oauth";
import { lightspeedAuthUrl, squareAuthUrl } from "@/lib/tills/clients";
import { missingSettings } from "@/lib/tills/providers";

// "Connect Square" / "Connect Lightspeed": sends the logged-in owner to their
// till's sign-in. /api/till/square/connect?r=<restaurant id>
// (Epos Now and Toast don't sign in this way: see /settings/till.)
export async function GET(req: NextRequest, ctx: RouteContext<"/api/till/[provider]/connect">) {
  const { provider } = await ctx.params;
  if (provider !== "square" && provider !== "lightspeed") return new Response("Not found", { status: 404 });
  const rid = req.nextUrl.searchParams.get("r") || "";
  const back = `/settings/till?r=${rid}`;
  const owner = await currentOwner();
  if (!owner) return Response.redirect(new URL(`/login?next=${encodeURIComponent(back)}`, req.url), 303);
  if (!rid || !owner.restaurantIds.includes(rid)) return new Response("Not found", { status: 404 });
  const missing = missingSettings(provider, process.env);
  if (missing.length) return Response.redirect(new URL(`${back}&error=${encodeURIComponent(`This till connection isn't switched on yet (missing ${missing.join(", ")}).`)}`, req.url), 303);
  const state = signState({ r: rid, as: "owner", email: owner.email, back });
  return Response.redirect(provider === "square" ? squareAuthUrl(state) : lightspeedAuthUrl(state), 303);
}
