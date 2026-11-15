import type { NextRequest } from "next/server";
import { appError, appJson, bearerToken, withOwner } from "@/lib/app-api";
import { appWebLink, safeNext } from "@/lib/auth";
import { appUrl } from "@/lib/supabase";

// POST { path: "/report/abc" }: a one-time link to that page on our website that opens
// already logged in (lib/auth.ts appWebLink). Only our own pages; anything else, or a
// login that can't have one, gets { url: null } and the app opens the page as it is.
export async function POST(req: NextRequest) {
  return withOwner(req, async () => {
    const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
    const path = typeof body?.path === "string" ? body.path : "";
    if (!path.startsWith("/") || safeNext(path) !== path || path.length > 500) return appError(400, "path");
    return appJson({ url: await appWebLink(bearerToken(req)!, path, appUrl()) });
  });
}
