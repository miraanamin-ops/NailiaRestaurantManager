// Removes everything a local test run created since a given time, so test
// edits and skip reasons don't teach the assistant anything.
// Usage: node --env-file=.env.local scripts/clear-test-data.mjs <since ISO timestamp>
import { createClient } from "@supabase/supabase-js";

const since = process.argv[2];
if (!since) throw new Error("Pass the start time of the test run, e.g. 2026-10-07T18:00:00Z");
const TEST_NUMBER = "whatsapp:+447700900999";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function del(table, build) {
  const { count, error } = await build(supabase.from(table).delete({ count: "exact" }));
  if (error) throw error;
  console.log(`${table}: deleted ${count}`);
}

await del("draft_feedback", (q) => q.gte("created_at", since));
await del("sent_log", (q) => q.gte("sent_at", since));
await del("drafts", (q) => q.gte("created_at", since));
await del("reviews", (q) => q.gte("created_at", since));
await del("messages", (q) => q.or(`from_number.eq."${TEST_NUMBER}",to_number.eq."${TEST_NUMBER}"`));
