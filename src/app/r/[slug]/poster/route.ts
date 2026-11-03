import type { NextRequest } from "next/server";
import { POSTER_SIZES, renderPoster, type PosterSize } from "@/lib/onboarding/qr-pack";
import { getRestaurantBySlug } from "@/lib/signups";
import { appUrl } from "@/lib/supabase";

// The print-ready QR poster (?size=A4 or A5) as a PDF. Public, like the QR pack
// and the sign-up page it leads to (only the name, colours and reward are on
// it), so WhatsApp can fetch it to send to the owner.
export async function GET(req: NextRequest, ctx: RouteContext<"/r/[slug]/poster">) {
  const { slug } = await ctx.params;
  const r = await getRestaurantBySlug(slug);
  if (!r) return new Response("Not found", { status: 404 });
  const asked = (req.nextUrl.searchParams.get("size") ?? "A4").toUpperCase();
  const size: PosterSize = (POSTER_SIZES as readonly string[]).includes(asked) ? (asked as PosterSize) : "A4";
  const pdf = await renderPoster(r, `${appUrl()}/r/${r.slug}`, size);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${r.slug}-qr-poster-${size}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
