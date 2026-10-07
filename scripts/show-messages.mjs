// Prints the WhatsApp message log from Supabase.
// Usage: node --env-file=.env.local scripts/show-messages.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { data, error } = await supabase
  .from("messages")
  .select("direction, from_number, to_number, status, body, error, created_at")
  .order("created_at");
if (error) throw error;
for (const m of data) {
  console.log(`\n[${m.created_at} | ${m.direction} | ${m.status}] ${m.from_number} -> ${m.to_number}\n${m.body}`);
  if (m.error) console.log(`ERROR: ${m.error}`);
}
