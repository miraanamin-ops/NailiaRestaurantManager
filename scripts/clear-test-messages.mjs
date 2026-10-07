// Deletes messages to/from the fake test number used by test-webhook.mjs.
// Usage: node --env-file=.env.local scripts/clear-test-messages.mjs
import { createClient } from "@supabase/supabase-js";

const TEST_NUMBER = "whatsapp:+447700900999";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { count, error } = await supabase
  .from("messages")
  .delete({ count: "exact" })
  .or(`from_number.eq."${TEST_NUMBER}",to_number.eq."${TEST_NUMBER}"`);
if (error) throw error;
console.log(`Deleted ${count} test message(s).`);
