// Seed scripts only ever add demo data to the dev project, never the live one.
// The live Supabase project is recognised by its project ref, which appears in
// its API URL and every connection string (as in analytics/generator/synth/dbsafety.py).
// Every scripts/seed-*.mjs calls refuseLive() before it connects (tests/seed-guards.test.ts).
export const PRODUCTION_REF = "gfrkcvcqmdhdhpcytlkc";

export function isLive(env) {
  return ["SUPABASE_URL", "DATABASE_URL"].some((k) => String(env[k] ?? "").includes(PRODUCTION_REF));
}

// Stops the script (exit code 2) if its settings point at the live database.
export function refuseLive(env, script, what = "adds demo data") {
  if (!isLive(env)) return;
  console.error(
    `REFUSED: ${script} ${what} and only runs against the dev project, but these settings point at the LIVE database (${PRODUCTION_REF}). Nothing was changed.\n` +
      "To remove dummy data from live, use scripts/clear-dummy-data.mjs.",
  );
  process.exit(2);
}

// Every other script that connects calls this first: against the live database it
// stops (exit code 2) unless run with --live (or ALLOW_LIVE=true), and then it says
// loudly that it is about to touch live. Local settings point at the dev project
// (.env.local in the worktree); live settings are a separate file, used on purpose.
export function guardLive(env, script, argv = process.argv) {
  if (!isLive(env)) return;
  if (!argv.includes("--live") && env.ALLOW_LIVE !== "true") {
    console.error(
      `REFUSED: ${script} is pointed at the LIVE database (${PRODUCTION_REF}). Nothing was read or changed.\n` +
        "Local work uses the dev project. If you really mean live, run it again with --live at the end.",
    );
    process.exit(2);
  }
  console.warn(`\n⚠️  ${script} is running against the LIVE database (${PRODUCTION_REF}).\n`);
}

// The arguments without --live, for scripts that read their own positional arguments.
export const withoutLiveFlag = (args) => args.filter((a) => a !== "--live");
