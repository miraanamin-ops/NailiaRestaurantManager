// End-to-end test of the customer sign-up flow against a running server.
// Uses Resend's test inbox (delivered@resend.dev), then deletes everything it made.
// Usage: node --env-file=.env.local scripts/test-signup.mjs [base url]
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SLUG = "ember-spice";
const EMAIL = "delivered@resend.dev";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
}
const post = (path, body, headers = {}) =>
  fetch(BASE + path, { method: "POST", body, redirect: "manual", headers });
const form = (fields) => new URLSearchParams(fields);
const page = async (path) => (await fetch(BASE + path)).text();

async function cleanup() {
  const { data: c } = await supabase.from("customers").select("id").eq("email", EMAIL);
  for (const { id } of c ?? []) {
    await supabase.from("customer_events").delete().eq("customer_id", id);
    await supabase.from("customers").delete().eq("id", id); // rewards cascade
  }
  await supabase.from("consents").delete().eq("email", EMAIL);
}

await cleanup();

// 1. Form page
const formHtml = await page(`/r/${SLUG}`);
check("form page shows consent wording", formHtml.includes("Send me offers and news from Ember &amp; Spice Grill by email."));
const consentTag = formHtml.match(/<input[^>]*name="consent"[^>]*>/)?.[0] ?? "";
check("consent box starts unticked", consentTag.includes('type="checkbox"') && !/\bchecked\b/.test(consentTag), consentTag);
check("form links to privacy notice", formHtml.includes(`/r/${SLUG}/privacy`));
check("privacy page loads", (await page(`/r/${SLUG}/privacy`)).includes("Privacy notice"));
check("QR page has a QR code", (await page(`/r/${SLUG}/qr`)).includes("<svg"));

// 2. Validation and bot trap
let res = await post(`/api/signup/${SLUG}`, form({ first_name: "Test", email: "not-an-email" }));
check("bad email is rejected", res.headers.get("location")?.includes("error=email"), res.headers.get("location"));
res = await post(`/api/signup/${SLUG}`, form({ first_name: "Bot", email: "bot@example.com", website: "spam" }));
const { count: botCount } = await supabase.from("customers").select("id", { count: "exact", head: true }).eq("email", "bot@example.com");
check("honeypot: bot gets 'thanks' but nothing is saved", res.status === 303 && botCount === 0);

// 3. Real sign-up with consent
res = await post(
  `/api/signup/${SLUG}`,
  form({ first_name: "Testy", email: EMAIL.toUpperCase(), birthday: "1995-05-20", consent: "yes" }),
  { "user-agent": "naila-test" },
);
const loc = res.headers.get("location") ?? "";
check("sign-up redirects to thanks", loc.includes("/thanks?status=new"), loc);
check("welcome email sent (no failure flag)", !loc.includes("email=failed"), loc);

const { data: customer } = await supabase.from("customers").select("*").eq("email", EMAIL).single();
check("customer saved with lowercased email", customer?.email === EMAIL && customer.source === "signup");
check("customer opted in", customer?.marketing_opt_in === true);
const { data: consents } = await supabase.from("consents").select("*").eq("email", EMAIL).order("created_at");
check(
  "consent saved with exact wording, form version and timestamp",
  consents?.[0]?.granted === true &&
    consents[0].wording === "Send me offers and news from Ember & Spice Grill by email." &&
    consents[0].form_version === "signup-v1" &&
    Boolean(consents[0].created_at),
);
const { data: reward } = await supabase.from("rewards").select("*").eq("customer_id", customer.id).single();
check("one-time reward issued", Boolean(reward?.token) && !reward.redeemed_at, reward?.reward);
const { data: events1 } = await supabase.from("customer_events").select("type, detail").eq("customer_id", customer.id);
check("sign-up and email logged", ["signup", "welcome_email_sent"].every((t) => events1?.some((e) => e.type === t)), JSON.stringify(events1));

// 4. Redemption
check("reward page shows Redeem now", (await page(`/reward/${reward.token}`)).includes("Redeem now"));
let r = await (await post(`/api/reward/${reward.token}/redeem`)).json();
check("first tap starts 10-minute window", r.state === "active" && Boolean(r.expiresAt));
const minutes = (new Date(r.expiresAt) - new Date(r.redeemedAt)) / 60000;
check("window is 10 minutes", minutes === 10, `${minutes} min`);
const r2 = await (await post(`/api/reward/${reward.token}/redeem`)).json();
check("second tap doesn't restart the window", r2.expiresAt === r.expiresAt);
const { count: redeemedEvents } = await supabase
  .from("customer_events")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", customer.id)
  .eq("type", "redeemed");
check("redemption logged once", redeemedEvents === 1, String(redeemedEvents));
check("reopening within 10 min shows the live screen", (await page(`/reward/${reward.token}`)).includes("reward-live"));

// Fast-forward past the 10 minutes.
await supabase.from("rewards").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", reward.id);
const usedHtml = await page(`/reward/${reward.token}`);
check("after 10 minutes: Already used, with date and time", usedHtml.includes("Already used") && usedHtml.includes("Redeemed on"));
check("…and no Redeem button", !usedHtml.includes("Redeem now"));

// 5. Repeat sign-up with the same email
res = await post(`/api/signup/${SLUG}`, form({ first_name: "Testy", email: EMAIL }));
check("repeat sign-up after using reward says 'used'", res.headers.get("location")?.includes("status=used"), res.headers.get("location"));
const { count: rewardCount } = await supabase.from("rewards").select("id", { count: "exact", head: true }).eq("customer_id", customer.id);
check("still only one reward", rewardCount === 1);

// 6. Unsubscribe
const unsubHtml = await page(`/unsubscribe/${customer.unsubscribe_token}`);
check("unsubscribe page shows button", unsubHtml.includes(">Unsubscribe</button>"));
res = await post(`/api/unsubscribe/${customer.unsubscribe_token}`, "");
check("unsubscribe redirects to confirmation", res.headers.get("location")?.includes("done=1"));
const { data: after } = await supabase.from("customers").select("marketing_opt_in, unsubscribed_at").eq("id", customer.id).single();
check("consent removed immediately", after.marketing_opt_in === false && Boolean(after.unsubscribed_at));
const { data: consents2 } = await supabase.from("consents").select("granted, source").eq("email", EMAIL).order("created_at");
check("withdrawal recorded in consents", consents2?.some((c) => c.granted === false && c.source === "unsubscribe_link"));
check("confirmation page says unsubscribed", (await page(`/unsubscribe/${customer.unsubscribe_token}`)).includes("unsubscribed"));
res = await post(`/api/unsubscribe/${customer.unsubscribe_token}`, "List-Unsubscribe=One-Click", {
  "content-type": "application/x-www-form-urlencoded",
});
check("one-click unsubscribe (email app button) works", res.status === 200);
const { count: unsubEvents } = await supabase
  .from("customer_events")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", customer.id)
  .eq("type", "unsubscribed");
check("unsubscribe logged once", unsubEvents === 1, String(unsubEvents));

// 7. Sign-up without ticking the box
const EMAIL2 = "delivered+noconsent@resend.dev";
res = await post(`/api/signup/${SLUG}`, form({ first_name: "NoTick", email: EMAIL2 }));
const { data: c2 } = await supabase.from("customers").select("id, marketing_opt_in").eq("email", EMAIL2).single();
const { data: cons2 } = await supabase.from("consents").select("granted").eq("email", EMAIL2).single();
check("unticked box: still signed up, not opted in, refusal recorded", c2?.marketing_opt_in === false && cons2?.granted === false);
if (c2) {
  await supabase.from("customer_events").delete().eq("customer_id", c2.id);
  await supabase.from("customers").delete().eq("id", c2.id);
}
await supabase.from("consents").delete().eq("email", EMAIL2);

await cleanup();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed. Test data deleted.");
process.exitCode = failures ? 1 : 0;
