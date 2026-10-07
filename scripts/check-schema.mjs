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
];
for (const [name, query] of checks) {
  const { error } = await query;
  console.log(`${error ? "MISSING" : "ok     "}  ${name}${error ? `  (${error.message})` : ""}`);
}
