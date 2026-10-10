import type { NextRequest } from "next/server";
import { submitFeedback } from "@/lib/feedback";
import { parseRating } from "@/lib/feedback-rules";
import { clientIp, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { baseUrlFrom } from "@/lib/supabase";

// The private feedback form posts here. 1-3 stars reach the owner on WhatsApp
// straight away; 4-5 stars go in their next morning brief.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/feedback/[token]">) {
  const { token } = await ctx.params;
  const page = (params: string) => Response.redirect(new URL(`/feedback/${token}?${params}`, baseUrlFrom(req.headers)), 303);
  if (await overLimit([{ key: limitKey("feedback-ip", clientIp(req.headers)), max: 10, windowMs: 10 * MINUTE }])) return page("error=slow");

  const form = await req.formData();
  const rating = parseRating(form.get("rating"));
  if (!rating) return page("error=rating");
  const comment = String(form.get("comment") ?? "").trim().slice(0, 1000) || null;
  const result = await submitFeedback(token, rating, comment);
  if (result === "not_found") return new Response("Not found", { status: 404 });
  return page("done=1");
}
