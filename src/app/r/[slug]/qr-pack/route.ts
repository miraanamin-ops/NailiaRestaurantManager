import type { NextRequest } from "next/server";
import { renderQrPack } from "@/lib/onboarding/qr-pack";
import { getRestaurantBySlug } from "@/lib/signups";
import { baseUrlFrom } from "@/lib/supabase";

// The printable QR pack (table cards and a counter sign) as a PDF. Public, like
// the sign-up page the codes lead to: it only shows the name, colours and reward.
export async function GET(req: NextRequest, ctx: RouteContext<"/r/[slug]/qr-pack">) {
  const { slug } = await ctx.params;
  const r = await getRestaurantBySlug(slug);
  if (!r) return new Response("Not found", { status: 404 });
  const pdf = await renderQrPack(r, `${baseUrlFrom(req.headers)}/r/${r.slug}`);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${r.slug}-qr-codes.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
