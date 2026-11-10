import "server-only";
import type Stripe from "stripe";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import { check } from "@/lib/drafts";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { cleanReferralCode, earnsReferralCredit, REFERRAL_CREDIT_PENCE, referralCodeFor, referralCreditedText } from "./referrals-rules";
import { getStripe } from "./stripe";

// Owner referrals (step 49): the rules are in referrals-rules.ts.

type Referral = Pick<Restaurant, "id" | "name" | "owner_email"> & { referral_code?: string | null; stripe_customer_id?: string | null };

// The restaurant's code, made the first time it's asked for (unique; a clash tries another).
export async function referralCodeOf(r: Pick<Restaurant, "id" | "name"> & { referral_code?: string | null }) {
  if (r.referral_code) return r.referral_code;
  const db = getSupabase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = referralCodeFor(r.name, r.id, attempt);
    const { data, error } = await db.from("restaurants").update({ referral_code: code }).eq("id", r.id).is("referral_code", null).select("referral_code").returns<{ referral_code: string }[]>();
    if (!error) {
      if (data?.length) return code;
      // Someone saved one in the meantime.
      const row = check(await db.from("restaurants").select("referral_code").eq("id", r.id).single<{ referral_code: string | null }>());
      if (row?.referral_code) return row.referral_code;
    } else if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Couldn't make a referral code");
}

export const referralLink = (code: string) => `${appUrl()}/start?ref=${encodeURIComponent(code)}`;

// The restaurant a typed code belongs to, or null.
export async function findReferrer(typed: string): Promise<Referral | null> {
  const code = cleanReferralCode(typed);
  if (!code) return null;
  return check(
    await getSupabase().from("restaurants").select("id, name, owner_email, referral_code, stripe_customer_id").eq("referral_code", code).maybeSingle<Referral>(),
  );
}

// A paid invoice for a recommended restaurant: its recommender gets one month
// free (a £99 credit on their Stripe balance), once. Called by the webhook on
// invoice.paid. A recommender with no Stripe billing (exempt or pilot) can't get
// a credit automatically: the builder is told to sort it out by hand.
export async function creditReferralIfDue(r: Restaurant & { referred_by?: string | null; referral_credited_at?: string | null }, invoice: Stripe.Invoice) {
  if (!earnsReferralCredit(invoice, r)) return "not_due" as const;
  const db = getSupabase();
  // Claimed first, so a repeated or parallel event can't credit twice.
  const claimed = check(
    await db.from("restaurants").update({ referral_credited_at: new Date().toISOString() }).eq("id", r.id).is("referral_credited_at", null).select("id").returns<{ id: string }[]>(),
  );
  if (!claimed?.length) return "already" as const;
  const referrer = check(await db.from("restaurants").select("*").eq("id", r.referred_by!).maybeSingle<Restaurant>());
  if (!referrer) return "no_referrer" as const;

  if (!referrer.stripe_customer_id) {
    await logAction({ restaurantId: referrer.id, actor: "stripe", action: "billing", detail: `Earned a free month: ${r.name} joined on their recommendation (no Stripe billing, so not credited automatically)`, data: { referred: r.id } });
    await alertBuilder(`referral:${r.id}`, `${referrer.name} earned a free month (${r.name} paid their first month), but has no Stripe billing (exempt or pilot). Credit it by hand if needed.`);
    return "manual" as const;
  }
  try {
    await getStripe().customers.createBalanceTransaction(
      referrer.stripe_customer_id,
      { amount: -REFERRAL_CREDIT_PENCE, currency: "gbp", description: `Free month: ${r.name} joined on your recommendation`, metadata: { referred_restaurant: r.id } },
      { idempotencyKey: `referral-credit-${r.id}` },
    );
  } catch (err) {
    // Let Stripe's retry try again.
    await db.from("restaurants").update({ referral_credited_at: null }).eq("id", r.id);
    throw err;
  }
  await logAction({ restaurantId: referrer.id, actor: "stripe", action: "billing", detail: `Free month credited (£99): ${r.name} joined on their recommendation`, data: { referred: r.id, invoice: invoice.id } });
  await logAction({ restaurantId: r.id, actor: "stripe", action: "billing", detail: `First payment: ${referrer.name}, who recommended DinerAI, got their free month`, data: { referrer: referrer.id } });
  const { ownerChannel } = await import("@/lib/followups");
  const channel = ownerChannel(referrer);
  if (channel) {
    const { messageOwner } = await import("@/lib/notify");
    await messageOwner(channel, referralCreditedText(r.name), false, { opener: "update" }).catch((err) => console.error("Couldn't tell the referrer", err));
  }
  return "credited" as const;
}
