"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { logAction } from "@/lib/audit";
import { createPasswordAccount, logInWithPassword } from "@/lib/auth";
import { createTrialCheckout } from "@/lib/billing/checkout";
import { signUpRestaurant } from "@/lib/signup/signup";
import { clientIp } from "@/lib/rate-limit";
import { baseUrlFrom } from "@/lib/supabase";
import { verifyTurnstile } from "@/lib/turnstile";

// The sign-up form ("Start free trial").
//   - An email that already has a running (or paid-for) restaurant is sent to log in:
//     nothing about billing, invites or terms is touched (lib/billing/signup-plan.ts).
//   - The owner chooses their password here; a brand-new email gets its login account
//     at once and is logged in (limited to this restaurant until they open a password
//     link we email; lib/auth.ts createPasswordAccount).
//   - While ONBOARDING_REQUIRES_PAYMENT is off (the default): an invite code is
//     required, and sign-up goes straight into onboarding with Dina ("You're in").
//   - A valid pilot invite code skips Stripe: straight into onboarding.
//   - Otherwise the restaurant is made (inactive) and the owner goes to Stripe Checkout
//     for the free trial; /start/return then sends them on to onboarding.
//     On the live site that's only open once PUBLIC_SIGNUP=true (invite-only before).
// A referral code (field "ref", or /start?ref=CODE) records who recommended them:
// that restaurant gets a free month once this one pays (lib/billing/referrals.ts).
// Protected by a hidden bot field, Cloudflare Turnstile (when its keys are set) and
// rate limits: 5 sign-ups per connection an hour, 20 a day.
export async function startSignup(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  // A hidden field people never see: bots that fill it in get the normal page but nothing is created.
  if (get("website")) redirect("/start?sent=1");

  const email = get("email").toLowerCase().slice(0, 200);
  const password = String(form.get("password") ?? "");
  const inviteTyped = get("invite");
  const referralTyped = get("ref").slice(0, 40);
  const back = (error: string) =>
    redirect(`/start?error=${error}${inviteTyped ? `&invite=${encodeURIComponent(inviteTyped.slice(0, 40))}` : ""}${referralTyped ? `&ref=${encodeURIComponent(referralTyped)}` : ""}`);

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  // The rules are shared with the app's sign-up (lib/signup/signup.ts).
  const outcome = await signUpRestaurant({
    ownerName: get("owner_name"),
    email,
    restaurantName: get("restaurant_name"),
    whatsapp: get("whatsapp"),
    password,
    terms: get("terms") === "yes",
    invite: inviteTyped,
    referral: referralTyped,
    channel: "web",
    ip,
    human: () => verifyTurnstile(get("cf-turnstile-response"), ip),
  });
  if (outcome.kind === "error") {
    if (outcome.code === "captcha") redirect(`/start?error=captcha&why=${encodeURIComponent(outcome.why ?? "failed")}`);
    return back(outcome.code);
  }
  if (outcome.kind === "login") return toLogin(outcome.next);

  const { restaurant, brandNew } = outcome;
  // In with an invite code: straight into setup with Dina.
  if (outcome.kind === "setup") {
    const next = `/onboarding/chat?r=${restaurant.id}`;
    if (await signIn(email, password, restaurant.id, brandNew)) redirect(next);
    return toLogin(next);
  }

  // Logged in before Stripe, so coming back from Checkout goes straight into setup.
  // TODO(stripe): the Stripe webhook calls startOnboarding once the trial starts.
  await signIn(email, password, restaurant.id, brandNew);
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await createTrialCheckout(restaurant, baseUrlFrom(requestHeaders));
  } catch (err) {
    console.error("Couldn't start Stripe Checkout", err);
  }
  if (!checkoutUrl) back("billing");
  // Logged after the owner is on their way to Stripe, so it doesn't slow them down.
  after(() => logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: "Sent to Stripe Checkout for the free trial" }));
  redirect(checkoutUrl!);
}

// Logs the owner in for this sign-up. Only an email we've never seen gets a new login
// account (with the chosen password, limited to this restaurant until the email is
// proved). Any other email only logs in if the password is right, so an earlier
// unfinished sign-up never lets in someone who merely typed that email. False: they
// log in (or reset the password) on the login page instead.
async function signIn(email: string, password: string, restaurantId: string, brandNew: boolean) {
  if (!brandNew) return logInWithPassword(email, password);
  const made = await createPasswordAccount(email, password, restaurantId);
  if (made.ok) return true;
  if (made.reason === "existing_user") return logInWithPassword(email, password);
  return false;
}

async function toLogin(next: string): Promise<never> {
  redirect(`/login?error=exists&next=${encodeURIComponent(next)}`);
}
