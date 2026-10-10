import type { NextRequest } from "next/server";
import { check } from "@/lib/drafts";
import { sendWelcomeEmail } from "@/lib/email";
import { clientIp, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { confirmEmail, getCustomerByConfirmToken, logEvent } from "@/lib/signups";
import { baseUrlFrom, getSupabase, type Restaurant } from "@/lib/supabase";

// "Confirm my email" was tapped: consent and the reward become active, and the
// branded welcome email (with the reward) goes out.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/confirm/[token]">) {
  const { token } = await ctx.params;
  const baseUrl = baseUrlFrom(req.headers);
  if (await overLimit([{ key: limitKey("confirm-ip", clientIp(req.headers)), max: 20, windowMs: 10 * MINUTE }])) {
    return new Response("Too many attempts. Please try again in a few minutes.", { status: 429 });
  }
  const customer = await getCustomerByConfirmToken(token);
  if (!customer) return new Response("Not found", { status: 404 });
  const restaurant = check(await getSupabase().from("restaurants").select("*").eq("id", customer.restaurant_id).maybeSingle<Restaurant>());
  if (!restaurant) return new Response("Not found", { status: 404 });

  const result = await confirmEmail(restaurant, token);
  if (result.state === "not_found") return new Response("Not found", { status: 404 });
  if ((result.state === "confirmed" || result.state === "already") && result.newReward && result.reward) {
    try {
      const sent = await sendWelcomeEmail({ restaurant, customer: result.customer, reward: result.reward, baseUrl });
      await logEvent(restaurant.id, customer.id, "welcome_email_sent", sent.id ?? sent.reason);
    } catch (err) {
      console.error("Welcome email failed", err);
      await logEvent(restaurant.id, customer.id, "email_failed", err instanceof Error ? err.message : String(err));
    }
  }
  return Response.redirect(new URL(`/confirm/${token}?done=1`, baseUrl), 303);
}
