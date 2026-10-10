// Clears ALL dummy data in one go. Shows what it would delete first; add --yes to delete.
//   - everything belonging to demo restaurants (restaurants.is_demo = true): customers,
//     reviews, drafts, campaigns, posts, messages, reports, logs and photos. The
//     restaurant itself (name, menu, settings) is kept, so it can be re-seeded.
//   - anything test commands or scripts made in any restaurant: NEW REVIEW reviews,
//     seeded sign-ups and reviews, and messages from the fake test number.
// Usage: node --env-file=.env.local scripts/clear-dummy-data.mjs [--yes]
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const YES = process.argv.includes("--yes");
const TEST_NUMBER = "whatsapp:+447700900999";
const ok = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
};

const { data: demos } = ok(await s.from("restaurants").select("id, name").eq("is_demo", true), "demo restaurants");
const ids = demos.map((d) => d.id);
console.log(`Demo restaurants: ${demos.map((d) => d.name).join(", ") || "none"}`);

// Children first, so nothing is left pointing at a deleted row.
const TABLES = [
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

// Test leftovers anywhere: dummy reviews and seeded rows (and their drafts), and the fake number's messages.
const extras = [
  ["reviews (made by NEW REVIEW or seeding)", s.from("reviews").select("id", { count: "exact", head: true }).in("source", ["dummy_google", "seed_report"])],
  ["customers (seeded)", s.from("customers").select("id", { count: "exact", head: true }).eq("notes", "report-seed")],
  ["messages (fake test number)", s.from("messages").select("id", { count: "exact", head: true }).or(`from_number.eq."${TEST_NUMBER}",to_number.eq."${TEST_NUMBER}"`)],
];
for (const [label, q] of extras) {
  const { count } = ok(await q, label);
  total += count ?? 0;
  console.log(`${YES ? "Deleting" : "Would delete"} ${String(count ?? 0).padStart(5)} ${label}`);
}
if (YES) {
  const dummyReviews = ok(await s.from("reviews").select("id").in("source", ["dummy_google", "seed_report"]), "find dummy reviews").data;
  if (dummyReviews.length) ok(await s.from("drafts").delete().in("review_id", dummyReviews.map((r) => r.id)), "delete their drafts");
  ok(await s.from("reviews").delete().in("source", ["dummy_google", "seed_report"]), "delete dummy reviews");
  ok(await s.from("customers").delete().eq("notes", "report-seed"), "delete seeded customers");
  ok(await s.from("messages").delete().or(`from_number.eq."${TEST_NUMBER}",to_number.eq."${TEST_NUMBER}"`), "delete test messages");
}

// Photos sent for Google posts, stored under each demo restaurant's folder.
for (const id of ids) {
  const { data: files } = await s.storage.from("post-photos").list(id, { limit: 1000 });
  const paths = (files ?? []).map((f) => `${id}/${f.name}`);
  total += paths.length;
  console.log(`${YES ? "Deleting" : "Would delete"} ${String(paths.length).padStart(5)} photos`);
  if (YES && paths.length) await s.storage.from("post-photos").remove(paths);
}

if (YES) {
  // Reset the demo restaurants' daily markers so the brief and report start fresh.
  if (ids.length) {
    ok(
      await s
        .from("restaurants")
        .update({ last_brief_on: null, last_brief_at: null, brief_waiting_since: null, last_report_on: null, morning_failures: 0, morning_failed_on: null })
        .in("id", ids),
      "reset demo restaurants",
    );
  }
  console.log(`\nDone: ${total} dummy rows and files cleared. Re-seed with scripts/seed-two-weeks.mjs if you want test data again.`);
} else {
  console.log(`\n${total} dummy rows and files would be cleared. Nothing has been deleted. Run again with --yes to delete them.`);
}
