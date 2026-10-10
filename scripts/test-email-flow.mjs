// End-to-end test of real customer email against a running server (local or live):
// sign up -> confirm -> welcome email -> redeem -> feedback email -> private
// feedback -> export -> delete my data. Uses the real database and Resend.
// Needs supabase/014_real_email.sql to have been run.
//
// Usage: node --env-file=.env.local scripts/test-email-flow.mjs [base url] [email]
//   base url: default http://localhost:3000 (the server needs the same CRON_SECRET)
//   email:    default delivered@resend.dev (Resend's test inbox). Use your own to see the emails.
// It removes everything it made at the end (pass --keep to look around afterwards).
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const KEEP = process.argv.includes("--keep");
const BASE = args[0] ?? "http://localhost:3000";
const EMAIL = (args[1] ?? "delivered@resend.dev").toLowerCase();
const SLUG = "ember-spice";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
// A made-up address for this run, so the sign-up rate limit doesn't trip on repeat runs (local only).
const IP = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
}
const post = (path, body, headers = {}) => fetch(BASE + path, { method: "POST", body, redirect: "manual", headers: { "x-forwarded-for": IP, ...headers } });
const form = (fields) => new URLSearchParams(fields);
const page = async (path) => (await fetch(BASE + path)).text();
const one = async (q) => (await q).data;

async function cleanup() {
  const { data: rid } = await supabase.from("restaurants").select("id").eq("slug", SLUG).single();
  const { data: c } = await supabase.from("customers").select("id").eq("restaurant_id", rid.id).eq("email", EMAIL);
  for (const { id } of c ?? []) {
    await supabase.from("customer_events").delete().eq("customer_id", id);
    await supabase.from("feedback_requests").delete().eq("customer_id", id); // feedback cascades
    await supabase.from("customers").delete().eq("id", id); // rewards cascade
  }
  await supabase.from("consents").delete().eq("restaurant_id", rid.id).eq("email", EMAIL);
  return rid.id;
}

const restaurantId = await cleanup();

// 1. The form has the "I'm human" check when Turnstile is set up.
const formHtml = await page(`/r/${SLUG}`);
check("sign-up form loads", formHtml.includes('name="consent"'));
console.log(`      (Turnstile widget on the form: ${formHtml.includes("cf-turnstile") ? "yes" : "no, TURNSTILE_SITE_KEY not set"})`);

// 2. Sign up: only the confirm email goes out; no reward, consent not active yet.
let res = await post(`/api/signup/${SLUG}`, form({ first_name: "Testy", email: EMAIL, consent: "yes" }), { "user-agent": "naila-test" });
let loc = res.headers.get("location") ?? "";
check("sign-up asks them to check their inbox", loc.includes("status=confirm") && !loc.includes("email=failed"), loc);
let customer = await one(supabase.from("customers").select("*").eq("restaurant_id", restaurantId).eq("email", EMAIL).single());
check("saved, but not confirmed and not opted in yet", customer && !customer.email_confirmed_at && customer.marketing_opt_in === false && customer.confirm_sent_at);
check("no reward before confirming", !(await one(supabase.from("rewards").select("id").eq("customer_id", customer.id).maybeSingle())));
const consent = await one(supabase.from("consents").select("*").eq("customer_id", customer.id).single());
check("consent recorded as given, waiting for confirmation", consent?.granted === true && !consent.confirmed_at && consent.form_version === "signup-v2");

// 3. Confirm: one tap on the page's button.
check("confirm page shows the button", (await page(`/confirm/${customer.confirm_token}`)).includes("Confirm my email"));
res = await post(`/api/confirm/${customer.confirm_token}`, "");
check("confirming goes to the 'you're confirmed' page", res.headers.get("location")?.includes("done=1"));
customer = await one(supabase.from("customers").select("*").eq("id", customer.id).single());
check("email confirmed and marketing consent now active", Boolean(customer.email_confirmed_at) && customer.marketing_opt_in === true);
const reward = await one(supabase.from("rewards").select("*").eq("customer_id", customer.id).single());
check("reward created on confirmation", Boolean(reward?.token));
const events = (await one(supabase.from("customer_events").select("type, detail").eq("customer_id", customer.id))) ?? [];
check("confirm and welcome emails sent", ["confirm_email_sent", "email_confirmed", "welcome_email_sent"].every((t) => events.some((e) => e.type === t)), JSON.stringify(events.map((e) => e.type)));
check("no email failures logged", !events.some((e) => e.type === "email_failed"), JSON.stringify(events.filter((e) => e.type === "email_failed")));

// 4. Redeem: the feedback email is scheduled for 3 hours later.
const r = await (await post(`/api/reward/${reward.token}/redeem`)).json();
check("reward redeemed", r.state === "active");
let fr = await one(supabase.from("feedback_requests").select("*").eq("customer_id", customer.id).single());
const delay = fr ? (new Date(fr.due_at) - new Date(reward.redeemed_at ?? r.redeemedAt)) / 3_600_000 : null;
check("feedback email scheduled 3 hours after redeeming", fr?.status === "pending" && Math.round(delay) === 3, `${delay} h`);

// 5. Pretend 3 hours have passed and run the hourly job once (exactly what the
// 5-past-the-hour run does: review check, due feedback emails, the once-a-day morning job).
await supabase.from("feedback_requests").update({ due_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", fr.id);
res = await fetch(`${BASE}/api/cron?job=hourly`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
check("hourly job accepted", res.ok, String(res.status));
for (let i = 0; i < 30 && fr.status === "pending"; i++) {
  await new Promise((ok) => setTimeout(ok, 2000));
  fr = await one(supabase.from("feedback_requests").select("*").eq("id", fr.id).single());
}
check("feedback email sent (or waiting for sending hours)", fr.status === "sent" || fr.status === "pending", `${fr.status}${fr.detail ? `: ${fr.detail}` : ""}`);

// 6. The feedback page always offers Google; a 2-star answer goes to the owner at once.
const fbHtml = await page(`/feedback/${fr.token}?rating=2`);
check("feedback page shows the Google review link before any rating", fbHtml.includes("Leave a Google review"));
res = await post(`/api/feedback/${fr.token}`, form({ rating: "2", comment: "Test: chips were cold" }));
check("private feedback saved", res.headers.get("location")?.includes("done=1"));
const fb = await one(supabase.from("feedback").select("*").eq("request_id", fr.id).single());
check("2 stars counts as negative", fb?.negative === true);
console.log(`      (owner alerted on WhatsApp: ${fb?.alerted_at ? "yes" : "no (no owner WhatsApp linked?)"})`);
check("thank-you page still shows the Google link", (await page(`/feedback/${fr.token}`)).includes("Leave a Google review"));

// 7. Export (the same link EXPORT CUSTOMERS sends on WhatsApp).
const exp = Math.floor(Date.now() / 1000) + 3600;
const sig = createHmac("sha256", process.env.LINK_SECRET || process.env.CRON_SECRET).update(`customer-export:${restaurantId}:${exp}`).digest("base64url");
res = await fetch(`${BASE}/export/customers?r=${restaurantId}&t=${exp}.${sig}`);
const csv = await res.text();
check("export downloads a CSV with the customer", res.ok && (res.headers.get("content-type") ?? "").includes("text/csv") && csv.includes(EMAIL));
res = await fetch(`${BASE}/export/customers?r=${restaurantId}&t=${exp}.bad`);
check("a tampered export link is refused", res.status === 403);
const exportLog = await one(supabase.from("audit_log").select("id").eq("restaurant_id", restaurantId).eq("action", "exported").gte("created_at", new Date(Date.now() - 120_000).toISOString()));
check("export written to the audit log", (exportLog ?? []).length > 0);

// 8. Delete my data.
check("delete page shows the button", (await page(`/delete/${customer.unsubscribe_token}`)).includes("Delete my data"));
res = await post(`/api/delete/${customer.unsubscribe_token}`, "");
check("deleting goes to the confirmation", res.headers.get("location")?.includes("done=1"));
const gone = await one(supabase.from("customers").select("*").eq("id", customer.id).single());
check("name, email and birthday removed; row kept for counts", gone.name === "Deleted customer" && gone.email === null && gone.birthday === null && Boolean(gone.deleted_at));
const consentsAfter = (await one(supabase.from("consents").select("email").eq("customer_id", customer.id))) ?? [];
check("consent records no longer hold the email", consentsAfter.every((c) => c.email === "deleted"));
const fbAfter = await one(supabase.from("feedback").select("comment, rating").eq("id", fb.id).single());
check("feedback comment removed, rating kept", fbAfter.comment === null && fbAfter.rating === 2);
const delLog = await one(supabase.from("audit_log").select("id, detail").eq("restaurant_id", restaurantId).eq("action", "data_deleted").contains("data", { customer_id: customer.id }));
check("deletion written to the audit log", (delLog ?? []).length === 1);
const csv2 = await (await fetch(`${BASE}/export/customers?r=${restaurantId}&t=${exp}.${sig}`)).text();
check("deleted customer no longer in the export", !csv2.includes(EMAIL));
check("redeemed reward still counted", Boolean(await one(supabase.from("rewards").select("id").eq("id", reward.id).maybeSingle())));

if (!KEEP) {
  await supabase.from("audit_log").delete().eq("restaurant_id", restaurantId).eq("action", "data_deleted").contains("data", { customer_id: customer.id });
  await supabase.from("customer_events").delete().eq("customer_id", customer.id);
  await supabase.from("feedback_requests").delete().eq("customer_id", customer.id);
  await supabase.from("consents").delete().eq("customer_id", customer.id);
  await supabase.from("customers").delete().eq("id", customer.id);
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
