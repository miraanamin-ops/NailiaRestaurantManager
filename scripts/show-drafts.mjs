// Prints drafts, feedback and the simulated sent log, newest last.
// Usage: node --env-file=.env.local scripts/show-drafts.mjs [since ISO timestamp]
import { createClient } from "@supabase/supabase-js";

const since = process.argv[2] ?? "1970-01-01";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const [drafts, feedback, sent] = await Promise.all([
  supabase.from("drafts").select("kind, status, waiting_for, version, audience, content").gte("created_at", since).order("created_at"),
  supabase.from("draft_feedback").select("kind, draft_kind, note").gte("created_at", since).order("created_at"),
  supabase.from("sent_log").select("channel, recipient, status, simulated").gte("sent_at", since).order("sent_at"),
]);
for (const r of [drafts, feedback, sent]) if (r.error) throw r.error;

console.log("=== DRAFTS");
for (const d of drafts.data) console.log(`- [${d.kind} | ${d.status} | waiting: ${d.waiting_for ?? "-"} | v${d.version}] ${d.audience}\n  ${d.content.replace(/\n/g, "\n  ")}`);
console.log("\n=== FEEDBACK");
for (const f of feedback.data) console.log(`- ${f.kind} (${f.draft_kind}): ${f.note}`);
console.log("\n=== SENT LOG");
for (const s of sent.data) console.log(`- ${s.channel} -> ${s.recipient} | ${s.status} | simulated=${s.simulated}`);
