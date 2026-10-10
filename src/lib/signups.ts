import "server-only";
import { randomBytes } from "node:crypto";
import { check, checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Bump these whenever the form or privacy notice wording changes, so every
// consent record says exactly which version the customer saw.
export const FORM_VERSION = "signup-v2";
export const PRIVACY_VERSION = "privacy-v2";
// How long the green "show at the till" screen stays valid after tapping Redeem.
export const REDEEM_MINUTES = 10;
// How long a "confirm your email" link works.
export const CONFIRM_DAYS = 7;

export function consentWording(restaurantName: string) {
  return `Send me offers and news from ${restaurantName} by email.`;
}

export function newToken() {
  return randomBytes(24).toString("base64url");
}

export type SignupCustomer = {
  id: string;
  restaurant_id: string;
  name: string;
  email: string;
  birthday: string | null;
  marketing_opt_in: boolean;
  unsubscribe_token: string | null;
  unsubscribed_at: string | null;
  source: string;
  // Double opt-in (step 13): nothing counts until the email is confirmed.
  email_confirmed_at: string | null;
  confirm_token: string | null;
  confirm_sent_at: string | null;
  deleted_at: string | null;
};

export type Reward = {
  id: string;
  restaurant_id: string;
  customer_id: string;
  token: string;
  reward: string;
  redeemed_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export async function getRestaurantBySlug(slug: string) {
  const res = await getSupabase().from("restaurants").select("*").eq("slug", slug).maybeSingle<Restaurant>();
  return check(res);
}

export async function logEvent(restaurantId: string, customerId: string | null, type: string, detail?: string) {
  const { error } = await getSupabase()
    .from("customer_events")
    .insert({ restaurant_id: restaurantId, customer_id: customerId, type, detail: detail ?? null });
  if (error) console.error("Failed to log customer event", error);
}

export type SignupInput = {
  firstName: string;
  email: string; // already trimmed and lowercased
  birthday: string | null;
  consent: boolean;
  userAgent: string | null;
};

type Existing = Pick<SignupCustomer, "email_confirmed_at" | "marketing_opt_in" | "unsubscribed_at">;
export type SignupPlan = "new" | "reconfirm" | "consent_confirm" | "repeat";

// What a sign-up means, given who's already there. Plain code (unit-tested).
//   new:             first time: save them, send the confirm email
//   reconfirm:       signed up before but never confirmed: send the confirm email again
//   consent_confirm: confirmed before, now ticking the box: the new consent needs confirming too
//   repeat:          nothing new (their reward email can be sent again)
export function signupPlan(existing: Existing | null, consent: boolean): SignupPlan {
  if (!existing) return "new";
  if (!existing.email_confirmed_at) return "reconfirm";
  const subscribed = existing.marketing_opt_in && !existing.unsubscribed_at;
  return consent && !subscribed ? "consent_confirm" : "repeat";
}

export type SignupResult = { plan: SignupPlan; customer: SignupCustomer; reward: Reward | null };

// Saves a sign-up. Consent is recorded exactly as given, but only becomes active
// (and the reward only exists) once the customer clicks the link in the confirm email.
export async function signUp(restaurant: Restaurant, input: SignupInput): Promise<SignupResult> {
  const supabase = getSupabase();
  const existing = check(
    await supabase
      .from("customers")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("email", input.email) // emails are stored lowercased
      .is("deleted_at", null)
      .maybeSingle<SignupCustomer>(),
  );
  const plan = signupPlan(existing, input.consent);

  let customer: SignupCustomer;
  if (existing) {
    customer = checkRow(
      await supabase
        .from("customers")
        .update({
          ...(input.birthday && !existing.birthday ? { birthday: input.birthday } : {}),
          unsubscribe_token: existing.unsubscribe_token ?? newToken(),
          ...(plan !== "repeat" ? { confirm_token: existing.confirm_token ?? newToken() } : {}),
        })
        .eq("restaurant_id", restaurant.id)
        .eq("id", existing.id)
        .select("*")
        .single<SignupCustomer>(),
    );
  } else {
    customer = checkRow(
      await supabase
        .from("customers")
        .insert({
          restaurant_id: restaurant.id,
          name: input.firstName,
          email: input.email,
          birthday: input.birthday,
          marketing_opt_in: false, // turned on when they confirm, if they ticked the box
          source: "signup",
          unsubscribe_token: newToken(),
          confirm_token: newToken(),
          visit_count: 0,
        })
        .select("*")
        .single<SignupCustomer>(),
    );
  }

  // Record the decision whether or not the box was ticked, with the exact wording.
  // A repeat visit that changes nothing adds no record.
  if (plan !== "repeat") {
    check(
      await supabase.from("consents").insert({
        restaurant_id: restaurant.id,
        customer_id: customer.id,
        email: input.email,
        granted: input.consent,
        wording: consentWording(restaurant.name),
        form_version: FORM_VERSION,
        privacy_version: PRIVACY_VERSION,
        source: "signup_form",
        user_agent: input.userAgent?.slice(0, 300) ?? null,
      }),
    );
  }

  const reward = check(
    await supabase.from("rewards").select("*").eq("restaurant_id", restaurant.id).eq("customer_id", customer.id).maybeSingle<Reward>(),
  );
  await logEvent(
    restaurant.id,
    customer.id,
    plan === "new" ? "signup" : "repeat_signup",
    plan === "new" ? (input.consent ? "Ticked the marketing box (active once confirmed)" : "Did not opt in") : plan,
  );
  return { plan, customer, reward };
}

// After a confirm email has gone out.
export async function markConfirmSent(customer: SignupCustomer) {
  check(
    await getSupabase()
      .from("customers")
      .update({ confirm_sent_at: new Date().toISOString() })
      .eq("restaurant_id", customer.restaurant_id)
      .eq("id", customer.id),
  );
  await logEvent(customer.restaurant_id, customer.id, "confirm_email_sent");
}

export function confirmExpired(customer: Pick<SignupCustomer, "confirm_sent_at" | "email_confirmed_at">, now = new Date()) {
  if (customer.email_confirmed_at || !customer.confirm_sent_at) return false;
  return now.getTime() - new Date(customer.confirm_sent_at).getTime() > CONFIRM_DAYS * 86_400_000;
}

export async function getCustomerByConfirmToken(token: string) {
  return check(await getSupabase().from("customers").select("*").eq("confirm_token", token).is("deleted_at", null).maybeSingle<SignupCustomer>());
}

export type ConfirmResult =
  | { state: "not_found" | "expired" }
  | { state: "confirmed" | "already"; customer: SignupCustomer; reward: Reward | null; newReward: boolean };

// The customer clicked "Confirm my email": their email counts, their latest
// consent choice becomes active, and their welcome reward is created.
export async function confirmEmail(restaurant: Restaurant, token: string, now = new Date()): Promise<ConfirmResult> {
  const supabase = getSupabase();
  const customer = await getCustomerByConfirmToken(token);
  if (!customer || customer.restaurant_id !== restaurant.id) return { state: "not_found" };
  if (confirmExpired(customer, now)) return { state: "expired" };

  const [pending] =
    check(
      await supabase
        .from("consents")
        .select("id, granted")
        .eq("restaurant_id", restaurant.id)
        .eq("customer_id", customer.id)
        .is("confirmed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .returns<{ id: string; granted: boolean }[]>(),
    ) ?? [];
  const firstConfirm = !customer.email_confirmed_at;
  if (pending) check(await supabase.from("consents").update({ confirmed_at: now.toISOString() }).eq("restaurant_id", restaurant.id).eq("id", pending.id));

  const updated = checkRow(
    await supabase
      .from("customers")
      .update({
        email_confirmed_at: customer.email_confirmed_at ?? now.toISOString(),
        ...(pending?.granted ? { marketing_opt_in: true, unsubscribed_at: null } : {}),
      })
      .eq("restaurant_id", restaurant.id)
      .eq("id", customer.id)
      .select("*")
      .single<SignupCustomer>(),
  );

  let reward = check(
    await supabase.from("rewards").select("*").eq("restaurant_id", restaurant.id).eq("customer_id", customer.id).maybeSingle<Reward>(),
  );
  let newReward = false;
  if (!reward) {
    const { data, error } = await supabase
      .from("rewards")
      .insert({ restaurant_id: restaurant.id, customer_id: customer.id, token: newToken(), reward: restaurant.signup_reward ?? "a little welcome treat" })
      .select("*")
      .single<Reward>();
    // 23505: a double click got there first.
    if (error && error.code !== "23505") throw new Error(error.message);
    reward = data ?? check(await supabase.from("rewards").select("*").eq("restaurant_id", restaurant.id).eq("customer_id", customer.id).maybeSingle<Reward>());
    newReward = Boolean(data);
  }

  if (!firstConfirm && !pending) return { state: "already", customer: updated, reward, newReward };
  await logEvent(restaurant.id, customer.id, "email_confirmed", pending?.granted ? "Marketing emails switched on" : "Reward only (no marketing emails)");
  return { state: "confirmed", customer: updated, reward, newReward };
}

export async function getReward(token: string) {
  return check(await getSupabase().from("rewards").select("*").eq("token", token).maybeSingle<Reward>());
}

export type RewardState = "unused" | "active" | "used";

export function rewardState(reward: Pick<Reward, "redeemed_at" | "expires_at">, now = new Date()): RewardState {
  if (!reward.redeemed_at || !reward.expires_at) return "unused";
  return new Date(reward.expires_at) > now ? "active" : "used";
}

// Starts the 10-minute redemption window. Only the first tap wins.
export async function redeemReward(token: string) {
  const supabase = getSupabase();
  const now = new Date();
  const claimed = check(
    await supabase
      .from("rewards")
      .update({ redeemed_at: now.toISOString(), expires_at: new Date(now.getTime() + REDEEM_MINUTES * 60_000).toISOString() })
      .eq("token", token)
      .is("redeemed_at", null)
      .select("*")
      .maybeSingle<Reward>(),
  );
  if (claimed) return { justRedeemed: true, reward: claimed };
  const reward = await getReward(token);
  return { justRedeemed: false, reward };
}

export async function getCustomerByUnsubscribeToken(token: string) {
  return check(
    await getSupabase().from("customers").select("*").eq("unsubscribe_token", token).maybeSingle<SignupCustomer>(),
  );
}

// Removes marketing consent immediately and records it.
export async function unsubscribe(token: string, source: string, userAgent: string | null) {
  const supabase = getSupabase();
  const customer = await getCustomerByUnsubscribeToken(token);
  if (!customer) return null;
  if (customer.deleted_at) return customer;
  if (!customer.unsubscribed_at || customer.marketing_opt_in) {
    check(
      await supabase
        .from("customers")
        .update({ marketing_opt_in: false, unsubscribed_at: new Date().toISOString() })
        .eq("id", customer.id),
    );
    check(
      await supabase.from("consents").insert({
        restaurant_id: customer.restaurant_id,
        customer_id: customer.id,
        email: customer.email,
        granted: false,
        wording: "Unsubscribed from all emails via the unsubscribe link.",
        form_version: FORM_VERSION,
        source,
        user_agent: userAgent?.slice(0, 300) ?? null,
        confirmed_at: new Date().toISOString(),
      }),
    );
    await logEvent(customer.restaurant_id, customer.id, "unsubscribed", source);
  }
  return customer;
}
