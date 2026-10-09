// Checks that the database scripts in supabase/ have been run.
// Usage: node --env-file=.env.local scripts/check-schema.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const checks = [
  ["setup.sql (tables + dummy data)", supabase.from("restaurants").select("id").limit(1)],
  ["002_messages.sql (message log)", supabase.from("messages").select("id").limit(1)],
  ["003_approval_loop.sql (draft columns)", supabase.from("drafts").select("waiting_for, audience, version").limit(1)],
  ["003_approval_loop.sql (feedback table)", supabase.from("draft_feedback").select("id").limit(1)],
  ["003_approval_loop.sql (sent_log.simulated)", supabase.from("sent_log").select("simulated").limit(1)],
  ["004_safety_rules.sql (restaurant settings)", supabase.from("restaurants").select("discount_cap_percent, paused, fake_now, owner_whatsapp").limit(1)],
  ["004_safety_rules.sql (draft send columns)", supabase.from("drafts").select("approved_at, scheduled_for, sent_at, check_notes").limit(1)],
  ["004_safety_rules.sql (blocked_sends table)", supabase.from("blocked_sends").select("id").limit(1)],
  ["005_customer_signups.sql (restaurant slug/reward)", supabase.from("restaurants").select("slug, signup_reward, brand_color").limit(1)],
  ["005_customer_signups.sql (customer columns)", supabase.from("customers").select("source, unsubscribe_token, unsubscribed_at").limit(1)],
  ["005_customer_signups.sql (consents/rewards/events)", supabase.from("consents").select("id").limit(1)],
  ["005_customer_signups.sql (rewards table)", supabase.from("rewards").select("id").limit(1)],
  ["005_customer_signups.sql (customer_events table)", supabase.from("customer_events").select("id").limit(1)],
  ["006_email_campaigns.sql (restaurant email settings)", supabase.from("restaurants").select("owner_email, email_test_mode, last_birthday_campaign_on").limit(1)],
  ["006_email_campaigns.sql (campaigns table)", supabase.from("campaigns").select("id").limit(1)],
  ["006_email_campaigns.sql (campaign_sends table)", supabase.from("campaign_sends").select("id").limit(1)],
];
for (const [name, query] of checks) {
  const { error } = await query;
  console.log(`${error ? "MISSING" : "ok     "}  ${name}${error ? `  (${error.message})` : ""}`);
}
