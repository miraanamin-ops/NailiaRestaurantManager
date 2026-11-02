// Local copies of the app use the dev Supabase project (dinerai-dev); only the
// deployed site uses the live one. If settings on this computer point at the
// live project, every database call stops with a clear message, unless
// ALLOW_LIVE=true says it's on purpose. No imports, so it's unit-tested
// (tests/live-guard.test.ts). The scripts have the same rule in
// scripts/lib/live-guard.mjs (same project ref, checked by the test).

export const LIVE_PROJECT_REF = "gfrkcvcqmdhdhpcytlkc";
export const DEV_PROJECT_REF = "nfphswknczyovnmnxjfa";

export function liveDatabaseRefusal(env: Record<string, string | undefined>): string | null {
  // On Vercel (the live site and its previews) the settings are Vercel's own.
  if (env.VERCEL) return null;
  if (!String(env.SUPABASE_URL ?? "").includes(LIVE_PROJECT_REF)) return null;
  if (env.ALLOW_LIVE === "true") return null;
  return (
    "STOPPED: this copy of DinerAI is running on your computer but its settings point at the LIVE database. " +
    "Use the dev settings (.env.local in the worktree points at dinerai-dev), or, if you really mean live, set ALLOW_LIVE=true."
  );
}

// Throws the refusal (for the places that make a Supabase client).
export function assertNotLiveByAccident(env: Record<string, string | undefined> = process.env) {
  const refusal = liveDatabaseRefusal(env);
  if (refusal) throw new Error(refusal);
}
