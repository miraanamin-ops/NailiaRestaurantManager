// Fills the founder dashboard's billing history (supabase/070 billing_history) from
// Stripe's own records, for restaurants that paid through Stripe before the
// webhooks started writing it: when each trial started and ended, each paid
// invoice, and when a subscription ended (with the owner's reason if given).
// Replaces only the "backfill" lines 070 wrote for those restaurants; lines the
// webhooks wrote are kept. Safe to run again (payments are keyed by invoice id).
//
//   node --env-file=.env.local scripts/founder-backfill-stripe.mjs            show what it would write
//   node --env-file=.env.local scripts/founder-backfill-stripe.mjs --apply    write it
//   (live: --env-file=.env.live.local ... --apply --live, with the LIVE Stripe key in STRIPE_SECRET_KEY)
import { createClient } from "@supabase/supabase-js";
import { guardLive } from "./lib/live-guard.mjs";

guardLive(process.env, "founder-backfill-stripe");
const apply = process.argv.includes("--apply");
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY first");
  process.exit(1);
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function stripe(path, params = {}) {
  const res = await fetch(`https://api.stripe.com/v1${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${key}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error?.message ?? res.status}`);
  return json;
}
async function listAll(path, params) {
  const out = [];
  let after;
  for (;;) {
    const page = await stripe(path, { ...params, limit: "100", ...(after ? { starting_after: after } : {}) });
    out.push(...page.data);
    if (!page.has_more) return out;
    after = page.data[page.data.length - 1].id;
  }
}
const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
const sum = (list) => (Array.isArray(list) ? list.reduce((n, x) => n + (Number(x?.amount) || 0), 0) : null);

const { data: restaurants, error } = await db.from("restaurants").select("id, name, stripe_customer_id, billing_exempt, pilot_invite_code").not("stripe_customer_id", "is", null);
if (error) throw new Error(error.message);
console.log(`${restaurants.length} restaurant(s) with a Stripe customer. ${apply ? "Writing." : "Dry run: nothing is written (add --apply)."}\n`);

for (const r of restaurants) {
  if (r.billing_exempt || r.pilot_invite_code) {
    console.log(`- ${r.name}: exempt or pilot, skipped`);
    continue;
  }
  const subs = await listAll("/subscriptions", { customer: r.stripe_customer_id, status: "all" });
  const invoices = await listAll("/invoices", { customer: r.stripe_customer_id, status: "paid" });
  const rows = [];
  for (const s of subs) {
    if (s.trial_start) rows.push({ at: iso(s.trial_start), standing: "trialing", detail: "Free trial started (from Stripe)" });
    const firstPaid = invoices.filter((i) => i.subscription === s.id && i.amount_paid > 0).map((i) => i.status_transitions?.paid_at ?? i.created).sort()[0];
    if (firstPaid) rows.push({ at: iso(firstPaid), standing: "active", detail: "First paid month (from Stripe)" });
    else if (s.trial_end && s.trial_end * 1000 < Date.now() && s.status !== "trialing") rows.push({ at: iso(s.trial_end), standing: s.status === "active" ? "active" : "ended", detail: "Trial ended (from Stripe)" });
    if (s.ended_at) {
      const d = s.cancellation_details ?? {};
      const reason = [d.feedback?.replace(/_/g, " "), d.comment].filter(Boolean).join(": ") || null;
      rows.push({ at: iso(s.ended_at), standing: "ended", detail: "Subscription ended (from Stripe)", cancel_reason: reason });
    }
  }
  const payments = invoices
    .filter((i) => i.amount_paid > 0)
    .map((i) => ({
      at: iso(i.status_transitions?.paid_at ?? i.created),
      amount_pence: i.amount_paid,
      tax_pence: typeof i.tax === "number" ? i.tax : sum(i.total_taxes),
      discount_pence: sum(i.total_discount_amounts),
      currency: i.currency,
      external_id: `stripe:${i.id}`,
    }));
  console.log(`- ${r.name}: ${rows.length} status change(s), ${payments.length} payment(s)`);
  for (const x of rows) console.log(`    ${x.at.slice(0, 10)} ${x.standing}${x.cancel_reason ? ` (${x.cancel_reason})` : ""}`);
  for (const p of payments) console.log(`    ${p.at.slice(0, 10)} paid £${(p.amount_pence / 100).toFixed(2)}`);
  if (!apply || (!rows.length && !payments.length)) continue;

  if (rows.length) {
    const del = await db.from("billing_history").delete().eq("restaurant_id", r.id).eq("source", "backfill");
    if (del.error) throw new Error(del.error.message);
    const ins = await db.from("billing_history").insert(rows.map((x) => ({ restaurant_id: r.id, source: "backfill", kind: "standing", ...x })));
    if (ins.error) throw new Error(ins.error.message);
  }
  if (payments.length) {
    const up = await db.from("billing_history").upsert(payments.map((p) => ({ restaurant_id: r.id, source: "stripe", kind: "payment", ...p })), { onConflict: "external_id", ignoreDuplicates: true });
    if (up.error) throw new Error(up.error.message);
  }
}
console.log(apply ? "\nDone." : "\nDry run finished. Run again with --apply to write it.");
