import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { reportFor } from "@/lib/app/more";

// One report: the saved snapshot (drawn by the app, never recalculated) and a
// one-day link to its PDF to share. Only the owner's own restaurant's.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) return appError(404, "not_found");
    const report = await reportFor(id, token);
    return report ? appJson(report) : appError(404, "not_found");
  });
}
