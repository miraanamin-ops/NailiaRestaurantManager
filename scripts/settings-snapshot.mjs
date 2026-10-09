// Saves or restores the restaurant's safety settings around a local test run,
// so testing with the fake number doesn't change where reminders go.
// Usage: node --env-file=.env.local scripts/settings-snapshot.mjs save|restore <file>
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [mode, file] = process.argv.slice(2);
if (!["save", "restore"].includes(mode) || !file) throw new Error("Usage: save|restore <file>");
const FIELDS =
  "id, discount_cap_percent, paused, paused_at, fake_now, owner_whatsapp, whatsapp_from, signup_reward, owner_email, email_test_mode, last_birthday_campaign_on, last_post_draft_on, last_brief_on, last_brief_at, brief_waiting_since, last_report_on";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

if (mode === "save") {
  const { data, error } = await supabase.from("restaurants").select(FIELDS).limit(1).single();
  if (error) throw error;
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log("Saved settings (owner number ends", String(data.owner_whatsapp ?? "none").slice(-3) + ")");
} else {
  const { id, ...fields } = JSON.parse(readFileSync(file, "utf8"));
  const { error } = await supabase.from("restaurants").update(fields).eq("id", id);
  if (error) throw error;
  console.log("Restored settings");
}
