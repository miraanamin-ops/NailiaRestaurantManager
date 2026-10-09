// Shows each review's source, whether the review check has handled it, and any posted reply.
// Usage: node --env-file=.env.local scripts/review-state.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { data, error } = await supabase
  .from("reviews")
  .select("author_name, rating, source, created_at, handled_at, replied, reply_posted_at")
  .order("created_at");
if (error) throw error;
for (const r of data) {
  console.log(
    `${r.author_name.padEnd(12)} ${r.rating}★ ${r.source.padEnd(13)} created ${r.created_at.slice(0, 16)} handled ${r.handled_at?.slice(0, 16) ?? "-"} replied=${r.replied} posted=${r.reply_posted_at?.slice(0, 16) ?? "-"}`,
  );
}
