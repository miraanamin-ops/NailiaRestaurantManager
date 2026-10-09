// Shows the draft on screen (waiting for the owner) and the queue behind it.
// Usage: node --env-file=.env.local scripts/show-queue.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { data, error } = await supabase
  .from("drafts")
  .select("kind, status, waiting_for, audience, created_at")
  .or("waiting_for.not.is.null,and(status.eq.pending,waiting_for.is.null)")
  .order("created_at");
if (error) throw error;
if (!data.length) console.log("Nothing on screen and nothing queued.");
for (const d of data) console.log(`${d.waiting_for ? `ON SCREEN (${d.waiting_for})` : "QUEUED"}  ${d.kind} · ${d.audience} · ${d.created_at.slice(0, 16)}`);
