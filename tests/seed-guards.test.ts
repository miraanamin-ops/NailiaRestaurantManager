// Demo data stays on the dev project: every seed script refuses the live database.
// The JS seeds (scripts/seed-*.mjs) check their settings with scripts/lib/live-guard.mjs
// before connecting; the SQL seeds (supabase/seed/) need the dev mark
// (tests/pilot-schema.test.ts); the generator's load.py has its own test
// (analytics/generator/tests/test_loader.py).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: a plain .mjs helper without types
import { isLive, PRODUCTION_REF } from "../scripts/lib/live-guard.mjs";

const SEEDS = readdirSync("scripts").filter((f) => /^seed-.*\.mjs$/.test(f));
const LIVE_URL = `https://${PRODUCTION_REF}.supabase.co`;

describe("seed scripts refuse the live database", () => {
  test("there are seed scripts, and every one calls the guard before it connects", () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(2);
    for (const f of SEEDS) {
      const src = readFileSync(`scripts/${f}`, "utf8");
      const guard = src.indexOf("refuseLive(process.env");
      expect(guard, `${f} must call refuseLive`).toBeGreaterThan(-1);
      expect(guard, `${f} must call refuseLive before createClient`).toBeLessThan(src.indexOf("createClient("));
    }
  });

  test("the live project is recognised in the API URL or a connection string", () => {
    expect(isLive({ SUPABASE_URL: LIVE_URL })).toBe(true);
    expect(isLive({ DATABASE_URL: `postgresql://postgres.${PRODUCTION_REF}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })).toBe(true);
    expect(isLive({ SUPABASE_URL: "https://nfphswknczyovnmnxjfa.supabase.co" })).toBe(false);
    expect(isLive({})).toBe(false);
  });

  test.each(SEEDS)("%s stops with live settings and changes nothing", (f) => {
    // No network: the script must stop before it reaches Supabase (an unreachable key proves nothing was sent).
    const run = spawnSync(process.execPath, [`scripts/${f}`], {
      env: { PATH: process.env.PATH, SUPABASE_URL: LIVE_URL, SUPABASE_SECRET_KEY: "not-a-key" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/REFUSED: .*LIVE database/);
    expect(run.stdout).toBe("");
  });
});
