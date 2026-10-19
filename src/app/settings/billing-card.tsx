import { billingNotice, billingStanding } from "@/lib/billing/access";
import { PRICE_GBP } from "@/lib/billing/config";
import type { Restaurant } from "@/lib/supabase";
import { openBilling } from "./actions";
import { button, Card } from "../onboarding/ui";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

// The banner at the top of settings when billing needs attention (a failed
// payment, a cancellation, the trial's end date).
export function BillingBanner({ r }: { r: Restaurant }) {
  const notice = billingNotice(r, date);
  if (!notice) return null;
  return (
    <p role={notice.tone === "warn" ? "alert" : undefined} className={`mb-4 rounded-xl px-4 py-3 ${notice.tone === "warn" ? "bg-amber-100 text-amber-950" : "bg-stone-200 text-stone-800"}`}>
      {notice.tone === "warn" ? "⚠️ " : ""}
      {notice.text}
    </p>
  );
}

// Plan, status and the "Manage billing" button (Stripe's Customer Portal).
export function BillingCard({ r }: { r: Restaurant }) {
  const { standing } = billingStanding(r);
  const status: Record<string, string> = {
    exempt: "Free (set up before billing)",
    pilot: `Pilot (invite code ${r.pilot_invite_code}): no charge`,
    trialing: r.trial_ends_at ? `Free trial until ${date(r.trial_ends_at)}` : "Free trial",
    active: r.current_period_end ? `£${PRICE_GBP} a month · next payment ${date(r.current_period_end)}` : `£${PRICE_GBP} a month`,
    past_due: "Payment failed: please update your card",
    ended: "Subscription ended",
    none: "No subscription yet",
  };
  return (
    <Card>
      <h2 className="text-lg font-bold">Billing</h2>
      <p className="text-stone-700">{status[standing]}</p>
      {r.cancel_at_period_end && r.current_period_end && <p className="text-sm text-stone-600">Cancelled: runs until {date(r.current_period_end)}.</p>}
      {r.stripe_customer_id ? (
        <form action={openBilling}>
          <input type="hidden" name="r" value={r.id} />
          <button className={button}>Manage billing</button>
          <p className="mt-2 text-sm text-stone-600">Update your card, see invoices or cancel. Cancelling keeps DinerAI until the end of the month you&apos;ve paid for.</p>
        </form>
      ) : standing === "none" || standing === "ended" ? (
        <a href={`/onboarding?r=${r.id}`} className={button}>
          Start free trial
        </a>
      ) : null}
    </Card>
  );
}
