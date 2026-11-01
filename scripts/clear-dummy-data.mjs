// Clears dummy data in one go. Shows what it would delete first; add --yes to delete.
// SAFETY NET: it only ever touches test sites (restaurants.is_demo AND is_test, made by
// the builder's setup test controls). A demo restaurant that isn't a test site (e.g.
// Ember & Spice, Cardamom Corner) is listed as skipped and nothing of it is touched,
// so a real restaurant marked demo by mistake can never lose its data here.
//   - everything belonging to those test sites: customers,
//     reviews, drafts, campaigns, posts, messages, reports, logs, photos, sales
//     (till reports, POS files and their saved column layouts, daily/hourly/item
//     sales). The restaurant itself (name, menu, settings, staff numbers) and its
//     weather (real, not dummy) are kept, so it can be re-seeded.
//   - anything test commands or scripts made in those test sites: NEW REVIEW reviews,
//     seeded sign-ups and reviews, and messages from the fake test number.
//   - operations data (staff, rotas, invoices, forecasts...; supabase/036_ops_analytics.sql
//     clear_ops_dummy_data, one test site at a time): everything except the menu, weather
//     and prayer times.
// Usage: node --env-file=.env.local scripts/clear-dummy-data.mjs [--yes]
import { createClient } from "@supabase/supabase-js";
import { guardLive } from "./lib/live-guard.mjs";

guardLive(process.env, "clear-dummy-data");
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const YES = process.argv.includes("--yes");
const TEST_NUMBER = "whatsapp:+447700900999";
const ok = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
};

const { data: demos } = ok(await s.from("restaurants").select("id, name, is_test").eq("is_demo", true), "demo restaurants");
const sites = demos.filter((d) => d.is_test === true);
const skipped = demos.filter((d) => d.is_test !== true);
const ids = sites.map((d) => d.id);
console.log(`Test sites (cleared): ${sites.map((d) => d.name).join(", ") || "none"}`);
if (skipped.length) console.log(`Skipped, demo but not a test site (nothing touched): ${skipped.map((d) => d.name).join(", ")}`);

// Children first, so nothing is left pointing at a deleted row.
const TABLES = [
  "sales_items",
  "sales_hours",
  "sales_days",
  "z_reports",
  "pos_imports",
  "pos_layouts",
  "forecast_briefs",
  "forecast_snapshots",
  "audit_log",
  "campaign_sends",
  "campaigns",
  "google_posts",
  "draft_feedback",
  "blocked_sends",
  "sent_log",
  "drafts",
  "reports",
  "feedback",
  "feedback_requests",
  "customer_events",
  "consents",
  "rewards",
  "customers",
  "reviews",
  "messages",
];

let total = 0;
for (const table of TABLES) {
  if (!ids.length) break;
  const { count } = ok(await s.from(table).select("id", { count: "exact", head: true }).in("restaurant_id", ids), `count ${table}`);
  total += count ?? 0;
  console.log(`${YES ? "Deleting" : "Would delete"} ${String(count ?? 0).padStart(5)} from ${table}`);
  if (YES && count) ok(await s.from(table).delete().in("restaurant_id", ids), `delete ${table}`);
}

// Test leftovers in the test sites: dummy reviews and seeded rows (and their drafts), and the fake number's messages.
// (Mostly already gone with the tables above; kept as a check. An empty list matches nothing.)
const only = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
const extras = [
  ["reviews (made by NEW REVIEW or seeding)", s.from("reviews").select("id", { count: "exact", head: true }).in("source", ["dummy_google", "seed_report"]).in("restaurant_id", only)],
  ["customers (seeded)", s.from("customers").select("id", { count: "exact", head: true }).eq("notes", "report-seed").in("restaurant_id", only)],
  ["messages (fake test number)", s.from("messages").select("id", { count: "exact", head: true }).or(`from_number.eq."${TEST_NUMBER}",to_number.eq."${TEST_NUMBER}"`).in("restaurant_id", only)],
];
for (const [label, q] of extras) {
  const { count } = ok(await q, label);
  total += count ?? 0;
  console.log(`${YES ? "Deleting" : "Would delete"} ${String(count ?? 0).padStart(5)} ${label}`);
}
if (YES) {
  const dummyReviews = ok(await s.from("reviews").select("id").in("source", ["dummy_google", "seed_report"]).in("restaurant_id", only), "find dummy reviews").data;
  if (dummyReviews.length) ok(await s.from("drafts").delete().in("review_id", dummyReviews.map((r) => r.id)).in("restaurant_id", only), "delete their drafts");
  ok(await s.from("reviews").delete().in("source", ["dummy_google", "seed_report"]).in("restaurant_id", only), "delete dummy reviews");
  ok(await s.from("customers").delete().eq("notes", "report-seed").in("restaurant_id", only), "delete seeded customers");
  ok(await s.from("messages").delete().or(`from_number.eq."${TEST_NUMBER}",to_number.eq."${TEST_NUMBER}"`).in("restaurant_id", only), "delete test messages");
}

// Photos sent for Google posts, stored under each demo restaurant's folder, and
// till report photos and POS files (private bucket, in z-reports/ and pos/ folders).
for (const id of ids) {
  const { data: files } = await s.storage.from("post-photos").list(id, { limit: 1000 });
  const paths = (files ?? []).map((f) => `${id}/${f.name}`);
  total += paths.length;
  console.log(`${YES ? "Deleting" : "Would delete"} ${String(paths.length).padStart(5)} photos`);
  if (YES && paths.length) await s.storage.from("post-photos").remove(paths);
  for (const folder of ["z-reports", "pos"]) {
    const { data: saved } = await s.storage.from("sales-files").list(`${id}/${folder}`, { limit: 1000 });
    const salesPaths = (saved ?? []).map((f) => `${id}/${folder}/${f.name}`);
    total += salesPaths.length;
    console.log(`${YES ? "Deleting" : "Would delete"} ${String(salesPaths.length).padStart(5)} ${folder === "pos" ? "sales files" : "till report photos"}`);
    if (YES && salesPaths.length) await s.storage.from("sales-files").remove(salesPaths);
  }
}

// Operations data: one database function, one test site at a time (it only counts unless --yes).
for (const id of ids) {
  const ops = ok(await s.rpc("clear_ops_dummy_data", { p_dry_run: !YES, p_restaurant_id: id }), "operations data");
  for (const row of ops.data ?? []) {
    if (!row.n_rows) continue;
    total += Number(row.n_rows);
    console.log(`${YES ? "Deleting" : "Would delete"} ${String(row.n_rows).padStart(5)} from ${row.table_name}`);
  }
}

if (YES) {
  // Reset the test sites' daily markers so the brief and report start fresh.
  if (ids.length) {
    ok(
      await s
        .from("restaurants")
        .update({ last_brief_on: null, last_brief_at: null, brief_waiting_since: null, last_report_on: null, morning_failures: 0, morning_failed_on: null })
        .in("id", ids),
      "reset demo restaurants",
    );
  }
  console.log(`\nDone: ${total} dummy rows and files cleared. Re-seed with scripts/seed-two-weeks.mjs and scripts/seed-sales.mjs if you want test data again.`);
} else {
  console.log(`\n${total} dummy rows and files would be cleared. Nothing has been deleted. Run again with --yes to delete them.`);
}
