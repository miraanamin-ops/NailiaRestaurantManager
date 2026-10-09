import "server-only";
import { randomBytes } from "node:crypto";
import { check, checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Bump these whenever the form or privacy notice wording changes, so every
// consent record says exactly which version the customer saw.
export const FORM_VERSION = "signup-v1";
export const PRIVACY_VERSION = "privacy-v1";
// How long the green "show at the till" screen stays valid after tapping Redeem.
export const REDEEM_MINUTES = 10;

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

export type SignupResult =
  | { status: "new"; customer: SignupCustomer; reward: Reward }
  | { status: "repeat"; customer: SignupCustomer; reward: Reward | null };

// Saves a sign-up: the customer, their consent decision and a one-time reward.
export async function signUp(restaurant: Restaurant, input: SignupInput): Promise<SignupResult> {
  const supabase = getSupabase();
  const wording = consentWording(restaurant.name);

  const existing = check(
    await supabase
      .from("customers")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("email", input.email) // emails are stored lowercased
      .maybeSingle<SignupCustomer>(),
  );

  let customer: SignupCustomer;
  if (existing) {
    // Same email again: keep one customer. Only ever turn consent ON here;
    // turning it off is what the unsubscribe link is for.
    customer = checkRow(
      await supabase
        .from("customers")
        .update({
          ...(input.birthday && !existing.birthday ? { birthday: input.birthday } : {}),
          ...(input.consent ? { marketing_opt_in: true, unsubscribed_at: null } : {}),
          unsubscribe_token: existing.unsubscribe_token ?? newToken(),
        })
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
          marketing_opt_in: input.consent,
          source: "signup",
          unsubscribe_token: newToken(),
          visit_count: 0,
        })
        .select("*")
        .single<SignupCustomer>(),
    );
  }

  // Record the decision whether or not the box was ticked, with the exact wording.
  check(
    await supabase.from("consents").insert({
      restaurant_id: restaurant.id,
      customer_id: customer.id,
      email: input.email,
      granted: input.consent,
      wording,
      form_version: FORM_VERSION,
      privacy_version: PRIVACY_VERSION,
      source: "signup_form",
      user_agent: input.userAgent?.slice(0, 300) ?? null,
    }),
  );

  const existingReward = check(
    await supabase.from("rewards").select("*").eq("customer_id", customer.id).maybeSingle<Reward>(),
  );
  if (existing) {
    await logEvent(restaurant.id, customer.id, "repeat_signup", existingReward ? "Already had a reward" : undefined);
    return { status: "repeat", customer, reward: existingReward };
  }

  const reward = checkRow(
    await supabase
      .from("rewards")
      .insert({
        restaurant_id: restaurant.id,
        customer_id: customer.id,
        token: newToken(),
        reward: restaurant.signup_reward ?? "a little welcome treat",
      })
      .select("*")
      .single<Reward>(),
  );
  await logEvent(restaurant.id, customer.id, "signup", input.consent ? "Opted in to marketing emails" : "Did not opt in");
  return { status: "new", customer, reward };
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
      }),
    );
    await logEvent(customer.restaurant_id, customer.id, "unsubscribed", source);
  }
  return customer;
}
