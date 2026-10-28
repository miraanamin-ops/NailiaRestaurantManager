"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { logAction } from "@/lib/audit";
import { emailLoginLink, looksLikeEmail, startSignupSession } from "@/lib/auth";
import { createTrialCheckout } from "@/lib/billing/checkout";
import { DPA_VERSION, onboardingRequiresPayment, PRIVACY_VERSION, publicSignupOpen, TERMS_VERSION } from "@/lib/billing/config";
import { startOnboarding } from "@/lib/onboarding/sessions";
import { claimInvite, cleanInviteCode } from "@/lib/billing/invites";
import { planSignup } from "@/lib/billing/signup-plan";
import { normaliseWhatsApp } from "@/lib/onboarding/steps";
import { createRestaurantFromSignup, getRestaurant, restaurantsForEmail, updateRestaurantFields } from "@/lib/onboarding/store";
import { clientIp, DAY, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { baseUrlFrom } from "@/lib/supabase";
import { verifyTurnstile } from "@/lib/turnstile";

// The sign-up form ("Start free trial").
//   - An email that already has a running (or paid-for) restaurant just gets a login
//     link: nothing about billing, invites or terms is touched (lib/billing/signup-plan.ts).
//   - While ONBOARDING_REQUIRES_PAYMENT is off (the default): an invite code is
//     required, and sign-up goes straight into onboarding with Dina ("You're in").
//   - A valid pilot invite code skips Stripe: straight to a login link into onboarding.
//   - Otherwise the restaurant is made (inactive) and the owner goes to Stripe Checkout
//     for the free trial; /start/return sends the login link afterwards.
//     On the live site that's only open once PUBLIC_SIGNUP=true (invite-only before).
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
  const inviteTyped = get("invite");
  const invite = cleanInviteCode(inviteTyped);
  const back = (error: string) => redirect(`/start?error=${error}${inviteTyped ? `&invite=${encodeURIComponent(inviteTyped.slice(0, 40))}` : ""}`);
  if (!ownerName || !restaurantName) back("missing");
  if (!looksLikeEmail(email)) back("email");
  if (!whatsapp) back("whatsapp");
  if (get("terms") !== "yes") back("terms");
  if (inviteTyped && !invite) back("invite");

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  // These don't depend on each other, so they run at the same time.
  const [human, limited, existing] = await Promise.all([
    verifyTurnstile(get("cf-turnstile-response"), ip),
    overLimit([
      { key: limitKey("start-ip-hour", ip), max: 5, windowMs: 60 * MINUTE },
      { key: limitKey("start-ip-day", ip), max: 20, windowMs: DAY },
    ]),
    restaurantsForEmail(email),
  ]);
  if (!human.ok) {
    console.warn("Turnstile rejected a restaurant sign-up", human.error);
    redirect(`/start?error=captcha&why=${encodeURIComponent(human.error ?? "failed")}`);
  }
  if (limited) back("slow");
  const base = baseUrlFrom(requestHeaders);

  const plan = planSignup(existing, restaurantName);
  if (plan.kind === "login") return sendLogin(email, plan.next, base);
  if (!invite && !publicSignupOpen()) back("invite_only");
  if (invite && !(await claimInvite(invite))) back("invite");

  // Pressing the button twice, or coming back after cancelling Checkout, carries on
  // with the same unfinished restaurant rather than making another.
  const restaurant = plan.kind === "continue" ? await getRestaurant(plan.restaurantId) : await createRestaurantFromSignup({ ownerName, email, restaurantName, whatsapp });
  const accepted = { terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, dpa_version: DPA_VERSION };

  // No paywall while onboarding is being tested (ONBOARDING_REQUIRES_PAYMENT off):
  // every sign-up has an invite code (checked above) and goes straight into
  // onboarding with Dina. TODO(stripe): with payment on, the code below this block
  // runs instead, and the Stripe webhook calls startOnboarding once the trial starts.
  if (!onboardingRequiresPayment() && invite) {
    await updateRestaurantFields(restaurant.id, { ...accepted, pilot_invite_code: invite });
    await startOnboarding(restaurant.id, { channel: "web" });
    await logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: `Signed up with invite code ${invite}: straight into setup`, data: { invite } });
    const next = `/onboarding/in?r=${restaurant.id}`;
    // A brand-new owner (no restaurant with this email before, and a login account
    // Supabase makes just now) is logged straight in, limited to this restaurant
    // (lib/auth.ts). Anyone else gets a login link by email, as before.
    if (plan.kind === "new" && !existing.length && (await startSignupSession(email, restaurant.id)).ok) {
      // The login email still goes, in the background: it's how they get back in on another device.
      after(async () => {
        const error = await emailLoginLink(email, next, base);
        if (error) console.warn("The sign-up login email didn't go", error);
      });
      redirect(next);
    }
    return sendLogin(email, next, base);
  }

  if (invite) {
    await updateRestaurantFields(restaurant.id, { ...accepted, pilot_invite_code: invite });
    await logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: `Signed up with pilot code ${invite}: no card needed`, data: { invite } });
    return sendLogin(email, `/onboarding?r=${restaurant.id}`, base);
  }

  const updated = await updateRestaurantFields(restaurant.id, accepted);
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await createTrialCheckout(updated, base);
  } catch (err) {
    console.error("Couldn't start Stripe Checkout", err);
  }
  if (!checkoutUrl) back("billing");
  // Logged after the owner is on their way to Stripe, so it doesn't slow them down.
  after(() => logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: "Sent to Stripe Checkout for the free trial" }));
  redirect(checkoutUrl!);
}

async function sendLogin(email: string, next: string, base: string): Promise<never> {
  const error = await emailLoginLink(email, next, base);
  if (error) redirect(`/start?error=${error}`);
  redirect("/start?sent=1");
}
