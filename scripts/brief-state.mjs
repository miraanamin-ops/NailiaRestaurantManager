// Shows the morning-brief state: new columns present, brief/report dates, and drafts waiting.
// Usage: node --env-file=.env.local scripts/brief-state.mjs
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const reports = await s.from("reports").select("id, headline, created_at").order("created_at", { ascending: false }).limit(3);
const r = await s
  .from("restaurants")
  .select("last_brief_on, last_brief_at, brief_waiting_since, last_report_on, owner_whatsapp, whatsapp_from, fake_now")
  .limit(1)
  .single();
const pending = await s
  .from("drafts")
  .select("kind, status, waiting_for, held_at, brief_number, briefed_at, audience, created_at")
  .eq("status", "pending")
  .order("created_at");

if (reports.error || r.error || pending.error) {
  console.log("Schema problem (has 008_brief_report.sql been run?):", reports.error?.message ?? r.error?.message ?? pending.error?.message);
  process.exit(1);
}
console.log("Restaurant:", { ...r.data, owner_whatsapp: r.data.owner_whatsapp ? `…${r.data.owner_whatsapp.slice(-3)}` : null });
console.log("Latest reports:", reports.data.map((x) => `${x.created_at.slice(0, 16)} ${x.headline.split("\n")[0]}`));
console.log(`Pending drafts (${pending.data.length}):`);
for (const d of pending.data) {
  console.log(`- ${d.created_at.slice(0, 16)} ${d.kind} for ${d.audience} | waiting=${d.waiting_for} held=${Boolean(d.held_at)} brief#=${d.brief_number ?? "-"}`);
}
