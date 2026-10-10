import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { check } from "@/lib/drafts";
import { SAMPLE_KINDS, sampleContent, type SampleKind } from "@/lib/email/previews";
import { renderEmail } from "@/lib/email/templates";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The real HTML of an automatic email, with sample details, for the owner to look at
// in their browser (linked from the settings page). Owner login needed.
export async function GET(req: NextRequest) {
  const owner = await currentOwner();
  const rid = req.nextUrl.searchParams.get("r") ?? "";
  if (!owner) return Response.redirect(new URL(`/login?next=${encodeURIComponent(`/settings?r=${rid}`)}`, req.url), 303);
  if (!owner.restaurantIds.includes(rid)) return new Response("Not found", { status: 404 });
  const kind = req.nextUrl.searchParams.get("kind") as SampleKind;
  if (!SAMPLE_KINDS.includes(kind)) return new Response("Unknown email", { status: 400 });
  const restaurant = check(await getSupabase().from("restaurants").select("*").eq("id", rid).maybeSingle<Restaurant>());
  if (!restaurant) return new Response("Not found", { status: 404 });
  const { html } = await renderEmail(sampleContent(restaurant, kind));
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}
