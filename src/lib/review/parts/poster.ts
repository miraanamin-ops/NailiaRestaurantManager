import "server-only";
import { renderPoster } from "@/lib/onboarding/qr-pack";
import { appUrl } from "@/lib/supabase";
import { logTimeSaved } from "../time-saved";
import type { PartResults } from "../types";
import type { PartContext } from ".";

// The QR poster: both sizes are drawn once here, so a broken one drops the
// section rather than sending the owner a link that fails.
export const posterUrl = (slug: string, size: "A4" | "A5") => `${appUrl()}/r/${slug}/poster?size=${size}`;

export async function posterPart(ctx: PartContext): Promise<PartResults["poster"]> {
  const r = ctx.restaurant;
  if (!r.slug) return { ready: false };
  const signup = `${appUrl()}/r/${r.slug}`;
  await renderPoster(r, signup, "A4");
  await renderPoster(r, signup, "A5");
  await logTimeSaved(r.id, "poster", `${ctx.review.id}:poster`);
  return { ready: true };
}
