"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { logAction } from "@/lib/audit";
import { createPasswordAccount, logInWithPassword, looksLikeEmail } from "@/lib/auth";
import { passwordProblem } from "@/lib/auth-rules";
import { createTrialCheckout } from "@/lib/billing/checkout";
import { DPA_VERSION, onboardingRequiresPayment, PRIVACY_VERSION, publicSignupOpen, TERMS_VERSION } from "@/lib/billing/config";
import { startOnboarding } from "@/lib/onboarding/sessions";
import { claimInvite, cleanInviteCode } from "@/lib/billing/invites";
import { findReferrer } from "@/lib/billing/referrals";
import { canRefer } from "@/lib/billing/referrals-rules";
import { planSignup } from "@/lib/billing/signup-plan";
import { normaliseWhatsApp } from "@/lib/onboarding/steps";
import { createRestaurantFromSignup, getRestaurant, restaurantsForEmail, updateRestaurantFields } from "@/lib/onboarding/store";
import { clientIp, DAY, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
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

  const ownerName = get("owner_name").slice(0, 80);
  const email = get("email").toLowerCase().slice(0, 200);
  const restaurantName = get("restaurant_name").slice(0, 80);
  const whatsapp = normaliseWhatsApp(get("whatsapp"));
  const password = String(form.get("password") ?? "");
  const inviteTyped = get("invite");
  const invite = cleanInviteCode(inviteTyped);
  const referralTyped = get("ref").slice(0, 40);
  const back = (error: string) =>
    redirect(`/start?error=${error}${inviteTyped ? `&invite=${encodeURIComponent(inviteTyped.slice(0, 40))}` : ""}${referralTyped ? `&ref=${encodeURIComponent(referralTyped)}` : ""}`);
  if (!ownerName || !restaurantName) back("missing");
  if (!looksLikeEmail(email)) back("email");
  if (!whatsapp) back("whatsapp");
  const weak = passwordProblem(password);
  if (weak) back(`password_${weak}`);
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

  const plan = planSignup(existing, restaurantName);
  if (plan.kind === "login") return toLogin(plan.next);
  // Recommended by another restaurant: who, checked before anything is made.
  const referrer = referralTyped ? await findReferrer(referralTyped) : null;
  if (referralTyped && (!referrer || !canRefer(referrer, { email }))) back("referral");
  if (!invite && !publicSignupOpen()) back("invite_only");
  if (invite && !(await claimInvite(invite))) back("invite");

  // Pressing the button twice, or coming back after cancelling Checkout, carries on
  // with the same unfinished restaurant rather than making another.
  const restaurant = plan.kind === "continue" ? await getRestaurant(plan.restaurantId) : await createRestaurantFromSignup({ ownerName, email, restaurantName, whatsapp });
  // A login account is only ever made for an email with no restaurant before.
  const brandNew = plan.kind === "new" && !existing.length;
  const accepted = {
    terms_accepted_at: new Date().toISOString(),
    terms_version: TERMS_VERSION,
    privacy_version: PRIVACY_VERSION,
    dpa_version: DPA_VERSION,
    ...(referrer && referrer.id !== restaurant.id && !restaurant.referred_by ? { referred_by: referrer.id } : {}),
  };
  if (referrer) after(() => logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: `Recommended by ${referrer.name} (code ${referrer.referral_code})`, data: { referrer: referrer.id } }));

  // No paywall while onboarding is being tested (ONBOARDING_REQUIRES_PAYMENT off):
  // every sign-up has an invite code (checked above) and goes straight into
  // onboarding with Dina. TODO(stripe): with payment on, the code below this block
  // runs instead, and the Stripe webhook calls startOnboarding once the trial starts.
  if (!onboardingRequiresPayment() && invite) {
    await updateRestaurantFields(restaurant.id, { ...accepted, pilot_invite_code: invite });
    await startOnboarding(restaurant.id, { channel: "web" });
    await logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: `Signed up with invite code ${invite}: straight into setup`, data: { invite } });
    const next = `/onboarding/chat?r=${restaurant.id}`;
    if (await signIn(email, password, restaurant.id, brandNew)) redirect(next);
    return toLogin(next);
  }

  if (invite) {
    await updateRestaurantFields(restaurant.id, { ...accepted, pilot_invite_code: invite });
    await startOnboarding(restaurant.id, { channel: "web" });
    await logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: `Signed up with pilot code ${invite}: no card needed`, data: { invite } });
    const next = `/onboarding/chat?r=${restaurant.id}`;
    if (await signIn(email, password, restaurant.id, brandNew)) redirect(next);
    return toLogin(next);
  }

  // Logged in before Stripe, so coming back from Checkout goes straight into setup.
  await signIn(email, password, restaurant.id, brandNew);
  const updated = await updateRestaurantFields(restaurant.id, accepted);
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await createTrialCheckout(updated, baseUrlFrom(requestHeaders));
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
