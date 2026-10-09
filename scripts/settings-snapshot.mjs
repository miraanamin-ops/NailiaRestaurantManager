// Saves or restores the restaurant's settings around a local test run.
// Only the registered owner number can use the assistant, so "test" saves the
// settings and then registers the fake test number (used by test-webhook.mjs)
// as the owner. Always "restore" afterwards to give the real owner their number back.
// Usage: node --env-file=.env.local scripts/settings-snapshot.mjs save|test|restore <file>
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TEST_NUMBER = "whatsapp:+447700900999";
const [mode, file] = process.argv.slice(2);
if (!["save", "test", "restore"].includes(mode) || !file) throw new Error("Usage: save|test|restore <file>");
const FIELDS =
  "id, discount_cap_percent, paused, paused_at, fake_now, owner_whatsapp, whatsapp_from, signup_reward, owner_email, email_test_mode, last_birthday_campaign_on, last_post_draft_on, last_brief_on, last_brief_at, brief_waiting_since, last_report_on";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

if (mode === "save" || mode === "test") {
  const { data, error } = await supabase.from("restaurants").select(FIELDS).limit(1).single();
  if (error) throw error;
  if (data.owner_whatsapp === TEST_NUMBER) throw new Error("The owner is already the test number: restore from your earlier snapshot first.");
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log("Saved settings (owner number ends", String(data.owner_whatsapp ?? "none").slice(-3) + ")");
  if (mode === "test") {
    const { error: e } = await supabase.from("restaurants").update({ owner_whatsapp: TEST_NUMBER }).eq("id", data.id);
    if (e) throw e;
    console.log("Test number registered as the owner. Run 'restore' when you're done.");
  }
} else {
  const { id, ...fields } = JSON.parse(readFileSync(file, "utf8"));
  const { error } = await supabase.from("restaurants").update(fields).eq("id", id);
  if (error) throw error;
  console.log("Restored settings (owner number ends", String(fields.owner_whatsapp ?? "none").slice(-3) + ")");
}
