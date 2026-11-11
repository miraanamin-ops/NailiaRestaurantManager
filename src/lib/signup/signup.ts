import "server-only";
import { logAction } from "@/lib/audit";
import { looksLikeEmail } from "@/lib/auth";
import { passwordProblem } from "@/lib/auth-rules";
import { appSignupOpen, DPA_VERSION, onboardingRequiresPayment, PRIVACY_VERSION, publicSignupOpen, TERMS_VERSION } from "@/lib/billing/config";
import { claimInvite, cleanInviteCode } from "@/lib/billing/invites";
import { findReferrer } from "@/lib/billing/referrals";
import { canRefer } from "@/lib/billing/referrals-rules";
import { planSignup } from "@/lib/billing/signup-plan";
import { normaliseWhatsApp } from "@/lib/onboarding/steps";
import { createRestaurantFromSignup, getRestaurant, restaurantsForEmail, updateRestaurantFields } from "@/lib/onboarding/store";
import { startOnboarding } from "@/lib/onboarding/sessions";
import { DAY, limitKey, MINUTE, overLimit, type Limit } from "@/lib/rate-limit";
import type { Restaurant } from "@/lib/supabase";

// Signing up a restaurant: one set of rules for the website (/start, app/start/actions.ts)
// and the app (/api/app/signup). Each front door only adds its own login session
// (cookies on the website, tokens in the app) and where the owner goes next.
//
//   - An email that already has a running (or paid-for) restaurant is sent to log in:
//     nothing about billing, invites or terms is touched (billing/signup-plan.ts).
//   - A valid invite code: straight into setup with Dina, no payment.
//   - Otherwise payment first: Stripe Checkout on the website, the App Store / Google
//     Play subscription in the app. Only once paid sign-up is open (billing/config.ts:
//     publicSignupOpen, appSignupOpen); invite-only before.
//   - A referral code records who recommended them (billing/referrals.ts).
// Rate limits per connection (and, in the app, a daily cap for all app sign-ups).

export type SignupChannel = "web" | "app";

export type SignupInput = {
  ownerName: string;
  email: string;
  restaurantName: string;
  whatsapp: string; // as typed; checked and normalised here
  // The password they chose, or null for Sign in with Apple / Google (the email is then
  // the one Apple or Google vouched for, verifiedEmail).
  password: string | null;
  verifiedEmail?: string | null;
  terms: boolean;
  invite: string;
  referral: string;
  channel: SignupChannel;
  ip: string;
  // The website's Cloudflare check; the app has no such check (see appLimits).
  human?: () => Promise<{ ok: boolean; error?: string | null }>;
};

export type SignupError =
  | "missing"
  | "email"
  | "whatsapp"
  | "password_short"
  | "password_long"
  | "terms"
  | "invite"
  | "invite_only"
  | "referral"
  | "slow"
  | "captcha";

export type SignupOutcome =
  | { kind: "error"; code: SignupError | `password_${string}`; why?: string }
  // The email already has a running or paid-for restaurant: log in instead.
  | { kind: "login"; next: string }
  // In with an invite code: setup with Dina has started.
  | { kind: "setup"; restaurant: Restaurant; brandNew: boolean; invite: string }
  // Payment first (Stripe on the website, the store in the app); setup starts once paid.
  | { kind: "pay"; restaurant: Restaurant; brandNew: boolean };

// The website: 5 sign-ups per connection an hour, 20 a day (plus Cloudflare).
export const webLimits = (ip: string): Limit[] => [
  { key: limitKey("start-ip-hour", ip), max: 5, windowMs: 60 * MINUTE },
  { key: limitKey("start-ip-day", ip), max: 20, windowMs: DAY },
];
// The app: no Cloudflare check is possible inside an app, so the same limits per
// connection, and per email, and a cap on all app sign-ups a day (a flood of fake
// ones stops there and the builder notices). A sign-up made this way can't do
// anything costly before an invite code or a store subscription (paid with a real
// Apple or Google account) lets it into setup.
export const APP_SIGNUPS_PER_DAY = 200;
export const appLimits = (ip: string, email: string): Limit[] => [
  { key: limitKey("app-signup-ip-hour", ip), max: 5, windowMs: 60 * MINUTE },
  { key: limitKey("app-signup-ip-day", ip), max: 20, windowMs: DAY },
  { key: limitKey("app-signup-email-day", email), max: 5, windowMs: DAY },
  { key: limitKey("app-signup-all"), max: APP_SIGNUPS_PER_DAY, windowMs: DAY },
];

// The checks that need nothing but the form, in the order the website has always shown them.
export function formProblem(input: Pick<SignupInput, "ownerName" | "email" | "restaurantName" | "whatsapp" | "password" | "verifiedEmail" | "terms" | "invite">): SignupOutcome | null {
  const err = (code: SignupError | `password_${string}`): SignupOutcome => ({ kind: "error", code });
  if (!input.ownerName.trim() || !input.restaurantName.trim()) return err("missing");
  if (!looksLikeEmail(input.email)) return err("email");
  if (!normaliseWhatsApp(input.whatsapp)) return err("whatsapp");
  if (input.password === null) {
    // Sign in with Apple / Google: only the email they vouched for.
    if (!input.verifiedEmail || input.verifiedEmail.toLowerCase() !== input.email.toLowerCase()) return err("email");
  } else {
    const weak = passwordProblem(input.password);
    if (weak) return err(`password_${weak}`);
  }
  if (!input.terms) return err("terms");
  if (input.invite.trim() && !cleanInviteCode(input.invite)) return err("invite");
  return null;
}

export async function signUpRestaurant(raw: SignupInput): Promise<SignupOutcome> {
  const input = {
    ...raw,
    ownerName: raw.ownerName.trim().slice(0, 80),
    email: raw.email.trim().toLowerCase().slice(0, 200),
    restaurantName: raw.restaurantName.trim().slice(0, 80),
    referral: raw.referral.trim().slice(0, 40),
  };
  const bad = formProblem(input);
  if (bad) return bad;
  const whatsapp = normaliseWhatsApp(input.whatsapp)!;
  const invite = cleanInviteCode(input.invite);

  // These don't depend on each other, so they run at the same time.
  const [human, limited, existing] = await Promise.all([
    input.human ? input.human() : Promise.resolve({ ok: true, error: null }),
    overLimit(input.channel === "web" ? webLimits(input.ip) : appLimits(input.ip, input.email)),
    restaurantsForEmail(input.email),
  ]);
  if (!human.ok) {
    console.warn("A sign-up failed the bot check", human.error);
    return { kind: "error", code: "captcha", why: human.error ?? "failed" };
  }
  if (limited) return { kind: "error", code: "slow" };

  const plan = planSignup(existing, input.restaurantName);
  if (plan.kind === "login") return { kind: "login", next: plan.next };
  // Recommended by another restaurant: who, checked before anything is made.
  const referrer = input.referral ? await findReferrer(input.referral) : null;
  if (input.referral && (!referrer || !canRefer(referrer, { email: input.email }))) return { kind: "error", code: "referral" };
  const open = input.channel === "web" ? publicSignupOpen() : appSignupOpen();
  if (!invite && !open) return { kind: "error", code: "invite_only" };
  if (invite && !(await claimInvite(invite))) return { kind: "error", code: "invite" };

  // Pressing the button twice, or coming back after not paying, carries on with the
  // same unfinished restaurant rather than making another.
  const restaurant =
    plan.kind === "continue"
      ? await getRestaurant(plan.restaurantId)
      : await createRestaurantFromSignup({ ownerName: input.ownerName, email: input.email, restaurantName: input.restaurantName, whatsapp });
  // A login account is only ever made for an email with no restaurant before.
  const brandNew = plan.kind === "new" && !existing.length;
  const accepted = {
    terms_accepted_at: new Date().toISOString(),
    terms_version: TERMS_VERSION,
    privacy_version: PRIVACY_VERSION,
    dpa_version: DPA_VERSION,
    ...(referrer && referrer.id !== restaurant.id && !restaurant.referred_by ? { referred_by: referrer.id } : {}),
  };
  const where = input.channel === "app" ? " in the app" : "";
  if (referrer) {
    await logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: `Recommended by ${referrer.name} (code ${referrer.referral_code})`, data: { referrer: referrer.id } }).catch(() => {});
  }

  if (invite) {
    const updated = await updateRestaurantFields(restaurant.id, { ...accepted, pilot_invite_code: invite });
    await startOnboarding(restaurant.id, { channel: "web" });
    const how = onboardingRequiresPayment() ? `Signed up${where} with pilot code ${invite}: no card needed` : `Signed up${where} with invite code ${invite}: straight into setup`;
    await logAction({ restaurantId: restaurant.id, actor: "owner", action: "billing", detail: how, data: { invite, channel: input.channel } });
    return { kind: "setup", restaurant: updated, brandNew, invite };
  }
  const updated = await updateRestaurantFields(restaurant.id, accepted);
  return { kind: "pay", restaurant: updated, brandNew };
}
