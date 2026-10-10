"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { emailLoginLink, looksLikeEmail } from "@/lib/auth";
import { normaliseWhatsApp } from "@/lib/onboarding/steps";
import { createRestaurantFromSignup, recentUnfinishedSignup } from "@/lib/onboarding/store";
import { clientIp, DAY, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { baseUrlFrom } from "@/lib/supabase";
import { verifyTurnstile } from "@/lib/turnstile";

// The sign-up form: creates the restaurant and emails a login link straight into onboarding.
// Protected by a hidden bot field, Cloudflare Turnstile (when its keys are set) and
// rate limits: 5 sign-ups per connection an hour, 20 a day.
export async function startSignup(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  // A hidden field people never see: bots that fill it in get the normal page but nothing is created.
  if (get("website")) redirect("/start?sent=1");

  const ownerName = get("owner_name").slice(0, 80);
  const email = get("email").toLowerCase().slice(0, 200);
  const restaurantName = get("restaurant_name").slice(0, 80);
  const whatsapp = normaliseWhatsApp(get("whatsapp"));
  if (!ownerName || !restaurantName) redirect("/start?error=missing");
  if (!looksLikeEmail(email)) redirect("/start?error=email");
  if (!whatsapp) redirect("/start?error=whatsapp");

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const human = await verifyTurnstile(get("cf-turnstile-response"), ip);
  if (!human.ok) {
    console.warn("Turnstile rejected a restaurant sign-up", human.error);
    redirect(`/start?error=captcha&why=${encodeURIComponent(human.error ?? "failed")}`);
  }
  if (
    await overLimit([
      { key: limitKey("start-ip-hour", ip), max: 5, windowMs: 60 * MINUTE },
      { key: limitKey("start-ip-day", ip), max: 20, windowMs: DAY },
    ])
  ) {
    redirect("/start?error=slow");
  }

  // Pressing the button twice (or signing up again before finishing) carries on
  // with the same restaurant rather than making another.
  const restaurant =
    (await recentUnfinishedSignup(email, restaurantName)) ?? (await createRestaurantFromSignup({ ownerName, email, restaurantName, whatsapp }));
  const error = await emailLoginLink(email, `/onboarding?r=${restaurant.id}`, baseUrlFrom(requestHeaders));
  if (error) redirect(`/start?error=${error}`);
  redirect(`/start?sent=1&email=${encodeURIComponent(email)}`);
}
