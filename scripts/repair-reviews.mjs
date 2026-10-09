// One-off repair after the step 7 test run: reviews that existed before the
// test count as already seen again, and test replies posted on them are removed.
// Usage: node --env-file=.env.local scripts/repair-reviews.mjs <test start ISO time>
import { createClient } from "@supabase/supabase-js";

const since = process.argv[2];
if (!since) throw new Error("Pass the test start time");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const { data: posted, error: e1 } = await supabase
  .from("reviews")
  .update({ reply_text: null, reply_posted_at: null, replied: false })
  .lt("created_at", since)
  .gte("reply_posted_at", since)
  .select("author_name");
if (e1) throw e1;
console.log("Removed test replies from:", posted.map((r) => r.author_name).join(", ") || "none");

const { data: old, error: e2 } = await supabase.from("reviews").select("id, created_at").lt("created_at", since);
if (e2) throw e2;
for (const r of old) {
  const { error } = await supabase.from("reviews").update({ handled_at: r.created_at }).eq("id", r.id);
  if (error) throw error;
}
console.log(`Marked ${old.length} pre-existing reviews as already seen`);
