import type { NextRequest } from "next/server";
import { growthPreviewPng } from "@/lib/agents/growth-preview";
import type { GrowthDraftOutput } from "@/lib/agents/growth-rules";
import { currentOwner } from "@/lib/auth";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// A picture of the email Growth drafted in shadow mode (builder only, for the /log
// comparison). The same template and wording a real send would use.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owner = await currentOwner();
  if (!owner?.isBuilder) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from("shadow_drafts")
    .select("restaurant_id, agent, output")
    .eq("id", id)
    .in("restaurant_id", owner.restaurantIds)
    .maybeSingle<{ restaurant_id: string; agent: string; output: GrowthDraftOutput }>();
  if (!row || row.agent !== "growth") return new Response("Not found", { status: 404 });
  const { data: restaurant } = await supabase.from("restaurants").select("*").eq("id", row.restaurant_id).single<Restaurant>();
  const png = restaurant ? await growthPreviewPng(restaurant, row.output) : null;
  if (!png) return new Response("No email to show", { status: 404 });
  return new Response(Buffer.from(png.data, "base64"), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}
