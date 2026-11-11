import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ownerFromToken, type Owner } from "@/lib/auth";

// The mobile app's API (step 50, docs/app-plan.md). The app logs in through
// /api/app/login and sends "Authorization: Bearer <access token>" on every call;
// each route starts with withOwner, so the website's login rules apply unchanged
// (only allowed emails, a sign-up login limited to its restaurant). Every query
// a route makes is then filtered by a restaurant the owner may see.

export const appError = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
export const appJson = (body: unknown) => NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });

export function bearerToken(req: Pick<NextRequest, "headers">) {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(\S{10,4096})$/i);
  return m ? m[1] : null;
}

export async function withOwner(req: Pick<NextRequest, "headers">, run: (owner: Owner) => Promise<Response>): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return appError(401, "login");
  const owner = await ownerFromToken(token).catch((err) => {
    console.error("App login check failed", err);
    return null;
  });
  if (!owner) return appError(401, "login");
  return run(owner);
}

// The restaurant a call is about: the one asked for if this owner may see it, else their first.
export function restaurantFor(owner: Owner, requested: string | null) {
  return requested && owner.restaurantIds.includes(requested) ? requested : (owner.restaurantIds[0] ?? null);
}
