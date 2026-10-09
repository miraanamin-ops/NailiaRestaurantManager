import type { NextRequest } from "next/server";
import { markOpened } from "@/lib/campaigns";

// A 1×1 transparent GIF in each campaign email: when it loads, the email was opened.
// (Approximate: some apps block images, and Apple Mail loads them in advance.)
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/t/open/[token]">) {
  const { token } = await ctx.params;
  try {
    await markOpened(token);
  } catch (err) {
    console.error("Failed to record open", err);
  }
  return new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" },
  });
}
