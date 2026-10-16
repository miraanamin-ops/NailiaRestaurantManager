// Checks, against the real Supabase database, that workers asking for jobs at
// the same moment never get the same one (the tests check the same thing in
// PGlite, which has a single connection, so there they take turns).
// It uses a temporary job type that only external workers run (so the app's
// workers never touch it), and removes everything it made at the end.
// Usage: node --env-file=.env.local scripts/queue-race.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const TYPE = "race_test";
const JOBS = 60;
const WORKERS = 20;

const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

try {
  must(await supabase.from("job_types").upsert({ type: TYPE, runner: "external", max_running: 1000, max_attempts: 1, description: "scripts/queue-race.mjs (temporary)" }), "add the test job type");
  for (let i = 0; i < JOBS; i++) {
    must(await supabase.rpc("enqueue_job", { p_type: TYPE, p_restaurant_id: null, p_key: `race:${Date.now()}:${i}` }), "queue a job");
  }
  // 20 workers, each asking for 5 jobs, all at once, twice over.
  const claims = await Promise.all(
    Array.from({ length: WORKERS * 2 }, (_, i) =>
      supabase.rpc("claim_jobs", { p_worker: `race-${i}`, p_types: [TYPE], p_limit: 5, p_runner: "external" }).then((r) => must(r, "claim")),
    ),
  );
  const ids = claims.flat().map((j) => j.id);
  const unique = new Set(ids).size;
  console.log(`${WORKERS * 2} claims at once took ${ids.length} jobs, ${unique} different.`);
  if (ids.length !== JOBS || unique !== JOBS) {
    console.log("PROBLEM: some jobs were missed or given out twice.");
    process.exitCode = 1;
  } else console.log("OK: every job was given to exactly one worker.");
} finally {
  await supabase.from("jobs").delete().eq("type", TYPE);
  await supabase.from("job_types").delete().eq("type", TYPE);
}
