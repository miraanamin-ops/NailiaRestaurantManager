// Inspects the latest email campaign and pokes its owner-copy link like a customer would.
// Usage: node --env-file=.env.local scripts/campaign-probe.mjs <base url> [summary|open|page|redeem]
import { createClient } from "@supabase/supabase-js";

const [base, action = "summary"] = process.argv.slice(2);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const { data: campaign } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false }).limit(1).single();
if (!campaign) throw new Error("No campaign");
const { data: sends } = await supabase.from("campaign_sends").select("*").eq("campaign_id", campaign.id);
const real = sends.filter((s) => s.delivery === "email");
const mine = real.find((s) => s.kind === "owner_copy") ?? real[0];

if (action === "summary") {
  const { data: draft } = await supabase.from("drafts").select("status, version").eq("id", campaign.draft_id).single();
  console.log(`Campaign "${campaign.name}" | draft ${draft.status} v${draft.version} | segment ${campaign.segment} | valid ${campaign.valid_from}..${campaign.valid_until}`);
  console.log(`Subject: ${campaign.subject}\nOffer: ${campaign.offer}`);
  console.log(`Sends: ${sends.length} total | real ${real.length} | simulated ${sends.filter((s) => s.delivery === "simulated").length} | failed ${sends.filter((s) => s.delivery === "failed").length} | excluded ${campaign.excluded_count} | eligible ${campaign.eligible_count}`);
  console.log(`Owner copy: ${mine ? `${mine.kind} resend_id=${mine.resend_id ?? "-"} opened=${Boolean(mine.opened_at)} clicked=${Boolean(mine.clicked_at)} redeemed=${Boolean(mine.redeemed_at)}` : "none"}`);
  const { data: optedOut } = await supabase.from("customers").select("email").eq("marketing_opt_in", false);
  const leaked = sends.filter((s) => optedOut.some((c) => c.email === s.email));
  console.log(`Customers without consent who got a send row: ${leaked.length}`);
} else if (action === "open") {
  const r = await fetch(`${base}/api/t/open/${mine.token}`);
  console.log("pixel:", r.status, r.headers.get("content-type"));
} else if (action === "page") {
  const html = await (await fetch(`${base}/offer/${mine.token}`)).text();
  const state = html.includes("Already used") ? "used" : html.includes("reward-live") ? "live" : html.includes("Redeem now") ? "redeemable" : html.match(/Valid from [^<]+|This offer has ended/)?.[0] ?? "unknown";
  console.log("offer page:", state);
} else if (action === "redeem") {
  const r = await fetch(`${base}/api/offer/${mine.token}/redeem`, { method: "POST" });
  console.log("redeem:", r.status, JSON.stringify(await r.json()));
}
