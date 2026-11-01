// Moves the two demo restaurants onto placeholder owner numbers (lib/switches.ts
// isPlaceholderNumber: +44 7700 900400 to 900499, never a real phone), so the
// builder's own number is free for a real restaurant. Afterwards the builder runs
// them from the demo phone (/onboarding/admin/phone). Shows the change first;
// add --yes to make it. --back puts the numbers given back (an undo).
//   node --env-file=.env.live.local scripts/demo-numbers.mjs --live                 (shows)
//   node --env-file=.env.live.local scripts/demo-numbers.mjs --live --yes           (moves them)
//   node --env-file=.env.live.local scripts/demo-numbers.mjs --live --yes --back ember-spice=whatsapp:+447... cardamom-corner=
// Only ever touches ember-spice and cardamom-corner, and refuses (changing
// nothing) unless both are demo restaurants. Run it only once the demo phone is
// live (after the onboarding-dina merge): the older code has no demo phone.
import { createClient } from "@supabase/supabase-js";
import { guardLive } from "./lib/live-guard.mjs";

guardLive(process.env, "demo-numbers");
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const YES = process.argv.includes("--yes");
const BACK = process.argv.includes("--back");
const PLACEHOLDERS = { "ember-spice": "whatsapp:+447700900401", "cardamom-corner": "whatsapp:+447700900402" };

const target = { ...PLACEHOLDERS };
if (BACK) {
  for (const a of process.argv.slice(2).filter((x) => x.includes("="))) {
    const [slug, number] = a.split("=");
    if (!(slug in target)) {
      console.error(`REFUSED: ${slug} isn't one of ${Object.keys(target).join(", ")}. Nothing changed.`);
      process.exit(2);
    }
    target[slug] = number || null;
  }
}

const { data, error } = await s.from("restaurants").select("id, name, slug, is_demo, owner_whatsapp").in("slug", Object.keys(target));
if (error) throw new Error(error.message);
const problems = Object.keys(target).flatMap((slug) => {
  const r = data.find((x) => x.slug === slug);
  return !r ? [`${slug}: not found`] : r.is_demo !== true ? [`${slug}: not a demo restaurant`] : [];
});
if (problems.length) {
  console.error(`REFUSED, nothing changed:\n  ${problems.join("\n  ")}`);
  process.exit(2);
}

// Another restaurant already on a target number would break the one-number-one-restaurant rule.
const wanted = Object.values(target).filter(Boolean);
const clash = await s.from("restaurants").select("slug, owner_whatsapp").in("owner_whatsapp", wanted);
if (clash.error) throw new Error(clash.error.message);
const clashes = clash.data.filter((c) => target[c.slug] !== c.owner_whatsapp);
if (clashes.length) {
  console.error(`REFUSED, nothing changed: ${clashes.map((c) => `${c.slug} already has ${c.owner_whatsapp}`).join(", ")}`);
  process.exit(2);
}

console.log("restaurants.owner_whatsapp:");
for (const r of data) console.log(`  ${r.name} (${r.slug}): ${r.owner_whatsapp ?? "(none)"}  ->  ${target[r.slug] ?? "(none)"}`);
console.log("Nothing else changes (their customers, drafts, messages and settings stay as they are).");
if (!YES) {
  console.log("\nShown only. Add --yes to make the change.");
  process.exit(0);
}
for (const r of data) {
  const { error: e } = await s.from("restaurants").update({ owner_whatsapp: target[r.slug] }).eq("id", r.id).eq("is_demo", true);
  if (e) throw new Error(`${r.slug}: ${e.message}`);
}
await s.from("audit_log").insert(
  data.map((r) => ({
    restaurant_id: r.id,
    actor: "builder",
    action: "setting",
    detail: `Owner number ${r.owner_whatsapp ?? "(none)"} -> ${target[r.slug] ?? "(none)"} (scripts/demo-numbers.mjs)`,
    data: { field: "owner_whatsapp", before: r.owner_whatsapp, after: target[r.slug] },
  })),
);
console.log("\nDone.");
