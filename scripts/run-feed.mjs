// Runs the outside data feeds by hand, against the live site (or a local dev
// server), through /api/feeds. Needs CRON_SECRET in .env.local.
// Usage:
//   node --env-file=.env.local scripts/run-feed.mjs status
//   node --env-file=.env.local scripts/run-feed.mjs run weather        (or calendar, prayer, football,
//                                                                       events, disruption, school_terms, all)
//   node --env-file=.env.local scripts/run-feed.mjs backfill <restaurant id>
//   node --env-file=.env.local scripts/run-feed.mjs coverage <restaurant id> [days]
// Add --base http://localhost:3000 to use a local server (default https://app.dinerai.co.uk).
const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt >= 0 ? args.splice(baseAt, 2)[1] : process.env.APP_URL || "https://app.dinerai.co.uk";
const [what, arg, days] = args;
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("Set CRON_SECRET in .env.local");
const headers = { authorization: `Bearer ${secret}` };

let res;
if (what === "status") res = await fetch(`${base}/api/feeds?status=1`, { headers });
else if (what === "run" && arg) res = await fetch(`${base}/api/feeds?run=${encodeURIComponent(arg)}`, { method: "POST", headers });
else if (what === "backfill" && arg) res = await fetch(`${base}/api/feeds?backfill=${encodeURIComponent(arg)}`, { method: "POST", headers });
else if (what === "coverage" && arg) res = await fetch(`${base}/api/feeds?coverage=${encodeURIComponent(arg)}&days=${days ?? 14}`, { headers });
else {
  console.log("Usage: run-feed.mjs status | run <feed|all> | backfill <restaurant id> | coverage <restaurant id> [days]");
  process.exit(1);
}
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const out = await res.json();
if (what === "status") {
  for (const f of out.feeds) {
    console.log(`${f.feed.padEnd(13)} ${f.enabled ? "on " : "off"}  last ok ${f.last_success_at?.slice(0, 16) ?? "never"}  ${f.last_outcome ?? ""}${f.last_error ? `  ${f.last_error.slice(0, 100)}` : ""}${f.last_detail?.skipped ? `  (${f.last_detail.skipped})` : ""}`);
  }
} else if (what === "coverage") {
  for (const r of out.rows) console.log(`${r.status === "live" ? "✓" : r.status === "missing" ? "✗" : "·"} ${r.group.padEnd(42)} ${(r.through ?? "").padEnd(10)} ${r.source}${r.note ? `  (${r.note})` : ""}`);
} else console.log(JSON.stringify(out, null, 2));
