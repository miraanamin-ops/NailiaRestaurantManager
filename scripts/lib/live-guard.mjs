// Seed scripts only ever add demo data to the dev project, never the live one.
// The live Supabase project is recognised by its project ref, which appears in
// its API URL and every connection string (as in analytics/generator/synth/dbsafety.py).
// Every scripts/seed-*.mjs calls refuseLive() before it connects (tests/seed-guards.test.ts).
export const PRODUCTION_REF = "gfrkcvcqmdhdhpcytlkc";

export function isLive(env) {
  return ["SUPABASE_URL", "DATABASE_URL"].some((k) => String(env[k] ?? "").includes(PRODUCTION_REF));
}

// Stops the script (exit code 2) if its settings point at the live database.
export function refuseLive(env, script) {
  if (!isLive(env)) return;
  console.error(
    `REFUSED: ${script} adds demo data and only runs against the dev project, but these settings point at the LIVE database (${PRODUCTION_REF}). Nothing was changed.\n` +
      "To remove dummy data from live, use scripts/clear-dummy-data.mjs.",
  );
  process.exit(2);
}
