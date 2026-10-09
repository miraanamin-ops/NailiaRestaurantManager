// Shows which database files in supabase/ have been run, using the
// schema_migrations table that every file adds its name to.
// Usage: node --env-file=.env.local scripts/check-schema.mjs
import { readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Files that must wait until the matching code is live on Vercel.
const AFTER_DEPLOY = { "010_drop_unused.sql": "run after the step 9 code is live" };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const files = readdirSync(new URL("../supabase/", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort((a, b) => (a === "setup.sql" ? -1 : b === "setup.sql" ? 1 : a.localeCompare(b)));

const { data, error } = await supabase.from("schema_migrations").select("name, applied_at");
if (error) {
  console.log(`Can't read schema_migrations (${error.message}).`);
  console.log("Run supabase/009_housekeeping.sql in Supabase > SQL Editor: it creates the table and records files 001-008.");
  process.exitCode = 1;
} else {
  report(new Map(data.map((m) => [m.name, m.applied_at])));
}

function report(applied) {
let missing = 0;
for (const f of files) {
  const when = applied.get(f);
  if (when) console.log(`ok        ${f}  (${when.slice(0, 16).replace("T", " ")})`);
  else {
    missing++;
    console.log(`NOT RUN   ${f}${AFTER_DEPLOY[f] ? `  (${AFTER_DEPLOY[f]})` : ""}`);
  }
}
for (const name of applied.keys()) if (!files.includes(name)) console.log(`(recorded but no such file: ${name})`);
console.log(missing ? `\n${missing} file(s) still to run.` : "\nEverything has been run.");
}
