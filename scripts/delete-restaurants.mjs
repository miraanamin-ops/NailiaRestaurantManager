// Deletes whole restaurants (test leftovers), by their link name (slug). Shows
// exactly what would go first; add --yes to delete.
//   node --env-file=.env.live.local scripts/delete-restaurants.mjs tayyabs-3 test-1 --live          (shows)
//   node --env-file=.env.live.local scripts/delete-restaurants.mjs tayyabs-3 test-1 --live --yes    (deletes)
// Safety: it refuses (and deletes nothing at all) if any named restaurant isn't
// found, isn't a demo restaurant, is switched on (active), or is one of the kept
// demo restaurants (ember-spice, cardamom-corner). Every table that points at a
// restaurant deletes its rows with it (on delete cascade; Stripe's event log only
// loses the link), so deleting the restaurant row removes everything; the files
// in storage aren't covered by that, so they're removed first. Login accounts
// (Supabase Auth) and invite codes are left alone.
import { readdirSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { guardLive } from "./lib/live-guard.mjs";

guardLive(process.env, "delete-restaurants");
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const YES = process.argv.includes("--yes");
const KEEP = ["ember-spice", "cardamom-corner"];
const BUCKETS = ["post-photos", "sales-files", "onboarding-uploads"];
const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slugs.length) {
  console.error("Name the restaurants by their link name (slug), e.g. tayyabs-3 test-1");
  process.exit(1);
}

// Every table with a restaurant_id column, read from the SQL files (so new tables are counted too).
const tables = new Set();
for (const f of readdirSync("supabase").filter((n) => /^(setup|\d{3}[a-z]?_).*\.sql$/.test(n))) {
  const sql = readFileSync(`supabase/${f}`, "utf8");
  for (const m of sql.matchAll(/create table if not exists\s+([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) if (/\brestaurant_id\b/.test(m[2])) tables.add(m[1]);
  for (const m of sql.matchAll(/alter table\s+([a-z_]+)\s+add column if not exists restaurant_id/gi)) tables.add(m[1]);
}

// (is_test only exists once migration 048 has run.)
let res = await s.from("restaurants").select("id, name, slug, is_demo, is_test, active, owner_email, created_at").in("slug", slugs);
if (res.error?.message.includes("is_test")) res = await s.from("restaurants").select("id, name, slug, is_demo, active, owner_email, created_at").in("slug", slugs);
if (res.error) throw new Error(res.error.message);
const found = res.data;
const problems = [];
for (const slug of slugs) {
  const r = found.find((x) => x.slug === slug);
  if (!r) problems.push(`${slug}: not found`);
  else if (KEEP.includes(slug)) problems.push(`${slug}: one of the kept demo restaurants`);
  else if (!r.is_demo) problems.push(`${slug}: not a demo restaurant (a real one is never deleted here)`);
  else if (r.active) problems.push(`${slug}: switched on (active)`);
}
if (problems.length) {
  console.error(`REFUSED, nothing deleted:\n  ${problems.join("\n  ")}`);
  process.exit(2);
}

// Every file under a restaurant's folder in a bucket, folders included.
async function filesUnder(bucket, prefix) {
  const out = [];
  const { data } = await s.storage.from(bucket).list(prefix, { limit: 1000 });
  for (const f of data ?? []) {
    const path = `${prefix}/${f.name}`;
    if (f.id === null) out.push(...(await filesUnder(bucket, path)));
    else out.push(path);
  }
  return out;
}

let grand = 0;
for (const r of found) {
  console.log(`\n${r.name} (${r.slug}), created ${r.created_at.slice(0, 10)}, demo${r.is_test ? ", test site" : ""}, ${r.active ? "on" : "off"}, owner email ${r.owner_email ?? "none"}`);
  console.log(`  ${YES ? "Deleting" : "Would delete"}     1 restaurants row`);
  let n = 1;
  for (const t of [...tables].sort()) {
    const { count, error: e } = await s.from(t).select("*", { count: "exact", head: true }).eq("restaurant_id", r.id);
    if (e) continue; // a table not on this database
    if (!count) continue;
    if (t !== "stripe_events") n += count; // kept (the link is removed), so not counted as removed
    console.log(`  ${YES ? "Deleting" : "Would delete"} ${String(count).padStart(5)} ${t}${t === "stripe_events" ? " (kept, link removed)" : ""}`);
  }
  for (const b of BUCKETS) {
    const paths = await filesUnder(b, r.id);
    if (!paths.length) continue;
    n += paths.length;
    console.log(`  ${YES ? "Deleting" : "Would delete"} ${String(paths.length).padStart(5)} files in ${b}`);
    if (YES) {
      const { error: e } = await s.storage.from(b).remove(paths);
      if (e) throw new Error(`files in ${b}: ${e.message}`);
    }
  }
  if (YES) {
    const { error: e } = await s.from("restaurants").delete().eq("id", r.id);
    if (e) throw new Error(`${r.slug}: ${e.message}`);
    const { count: left } = await s.from("restaurants").select("id", { count: "exact", head: true }).eq("id", r.id);
    console.log(left ? `  STILL THERE: ${r.slug}` : "  Deleted.");
  }
  grand += n;
}
console.log(YES ? `\nDone: ${found.length} restaurants and ${grand} rows and files removed.` : `\n${found.length} restaurants, ${grand} rows and files would be removed. Nothing has been deleted. Run again with --yes to delete them.`);
