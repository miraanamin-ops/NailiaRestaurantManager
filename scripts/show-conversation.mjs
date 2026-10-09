// Prints the test conversation (fake number) and blocked sends since a time.
// Usage: node --env-file=.env.local scripts/show-conversation.mjs <since ISO timestamp>
import { createClient } from "@supabase/supabase-js";

const since = process.argv[2] ?? "1970-01-01";
const TEST_NUMBER = "whatsapp:+447700900999";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const [msgs, blocks] = await Promise.all([
  supabase
    .from("messages")
    .select("direction, body, created_at")
    .or(`from_number.eq."${TEST_NUMBER}",to_number.eq."${TEST_NUMBER}"`)
    .gte("created_at", since)
    .order("created_at"),
  supabase.from("blocked_sends").select("reason, detail, created_at").gte("created_at", since).order("created_at"),
]);
if (msgs.error) throw msgs.error;
if (blocks.error) throw blocks.error;

for (const m of msgs.data) {
  console.log(m.direction === "inbound" ? `\n>>> ME: ${m.body}` : `<<< NAILA: ${m.body.replace(/\n/g, "\n    ")}`);
}
console.log("\n=== BLOCKED_SENDS");
for (const b of blocks.data) console.log(`- ${b.reason}: ${b.detail}`);
