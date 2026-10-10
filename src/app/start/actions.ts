"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { emailLoginLink, looksLikeEmail } from "@/lib/auth";
import { normaliseWhatsApp } from "@/lib/onboarding/steps";
import { createRestaurantFromSignup, recentUnfinishedSignup } from "@/lib/onboarding/store";
import { baseUrlFrom } from "@/lib/supabase";

// The sign-up form: creates the restaurant and emails a login link straight into onboarding.
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

  // Pressing the button twice (or signing up again before finishing) carries on
  // with the same restaurant rather than making another.
  const restaurant =
    (await recentUnfinishedSignup(email, restaurantName)) ?? (await createRestaurantFromSignup({ ownerName, email, restaurantName, whatsapp }));
  const error = await emailLoginLink(email, `/onboarding?r=${restaurant.id}`, baseUrlFrom(await headers()));
  if (error) redirect(`/start?error=${error}`);
  redirect(`/start?sent=1&email=${encodeURIComponent(email)}`);
}
