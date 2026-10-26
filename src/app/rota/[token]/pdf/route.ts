import type { NextRequest } from "next/server";
import { rotaByToken } from "@/lib/rota/build";
import { weekLabel } from "@/lib/rota/message";
import { renderRotaPdf } from "@/lib/rota/pdf";
import { rotaView } from "@/lib/rota/view";

// The published rota as a PDF (public like the page: whoever has the link; WhatsApp fetches it to attach it).
export async function GET(_req: NextRequest, ctx: RouteContext<"/rota/[token]/pdf">) {
  const { token } = await ctx.params;
  const week = await rotaByToken(token);
  if (!week?.summary) return new Response("Rota not found", { status: 404 });
  const plan = week.summary;
  const pdf = await renderRotaPdf(rotaView(plan, { restaurant: plan.restaurant.name, week: weekLabel(week.week_start) }), plan.restaurant.brand_color ?? "#1c1917");
  const slug = plan.restaurant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug}-rota-${week.week_start}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
