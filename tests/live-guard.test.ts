// Local work uses the dev project; the live database is only ever touched on
// purpose. The app (lib/live-guard.ts: getSupabase, the login client, the proxy)
// stops on this computer if its settings point at live, unless ALLOW_LIVE=true;
// every script that connects stops unless run with --live (seeds always stop).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEV_PROJECT_REF, LIVE_PROJECT_REF, liveDatabaseRefusal } from "@/lib/live-guard";
// @ts-expect-error: a plain .mjs helper without types
import { PRODUCTION_REF } from "../scripts/lib/live-guard.mjs";

const LIVE_URL = `https://${LIVE_PROJECT_REF}.supabase.co`;
const DEV_URL = `https://${DEV_PROJECT_REF}.supabase.co`;

describe("the app on this computer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("live settings are refused unless ALLOW_LIVE=true; dev settings and Vercel are fine", () => {
    expect(liveDatabaseRefusal({ SUPABASE_URL: LIVE_URL })).toMatch(/STOPPED.*LIVE database.*ALLOW_LIVE=true/);
    expect(liveDatabaseRefusal({ SUPABASE_URL: LIVE_URL, ALLOW_LIVE: "true" })).toBeNull();
    expect(liveDatabaseRefusal({ SUPABASE_URL: LIVE_URL, ALLOW_LIVE: "yes" })).not.toBeNull();
    expect(liveDatabaseRefusal({ SUPABASE_URL: DEV_URL })).toBeNull();
    expect(liveDatabaseRefusal({ SUPABASE_URL: LIVE_URL, VERCEL: "1" })).toBeNull();
    expect(liveDatabaseRefusal({})).toBeNull();
  });

  test("the app and the scripts know the same live project", () => {
    expect(PRODUCTION_REF).toBe(LIVE_PROJECT_REF);
  });

  test("getSupabase stops before making a client for live settings", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("SUPABASE_URL", LIVE_URL);
    vi.stubEnv("SUPABASE_SECRET_KEY", "not-a-key");
    vi.stubEnv("ALLOW_LIVE", "");
    const { getSupabase } = await import("@/lib/supabase");
    expect(() => getSupabase()).toThrow(/LIVE database/);
    vi.stubEnv("SUPABASE_URL", DEV_URL);
    expect(() => getSupabase()).not.toThrow();
  });
});

describe("the scripts", () => {
  const connecting = readdirSync("scripts").filter((f) => /\.(mjs|ts)$/.test(f) && /SUPABASE_URL|DATABASE_URL/.test(readFileSync(`scripts/${f}`, "utf8")));
  const guarded = connecting.filter((f) => !f.startsWith("seed-"));

  test("every script that connects calls the guard before it connects", () => {
    expect(guarded.length).toBeGreaterThanOrEqual(17);
    for (const f of guarded) {
      const src = readFileSync(`scripts/${f}`, "utf8");
      // guardLive (live only with --live), or refuseLive for dev-only scripts (never live).
      const guard = Math.max(src.indexOf("guardLive(process.env"), src.indexOf("refuseLive(process.env"));
      expect(guard, `${f} must call guardLive or refuseLive`).toBeGreaterThan(-1);
      const connect = Math.min(...["createClient(", "await db<", "fetch(`${env(\"SUPABASE_URL\")}"].map((s) => src.indexOf(s)).filter((i) => i >= 0));
      expect(guard, `${f} must call guardLive before it connects`).toBeLessThan(connect);
    }
  });

  test.each(guarded)("%s stops on live settings without --live, and touches nothing", (f) => {
    // No network: an unreachable key proves nothing was sent.
    const run = spawnSync(process.execPath, [`scripts/${f}`, "x", "y"], {
      env: { PATH: process.env.PATH, SUPABASE_URL: LIVE_URL, SUPABASE_SECRET_KEY: "not-a-key" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(run.status, run.stderr).toBe(2);
    expect(run.stderr).toMatch(/REFUSED: .* LIVE database/);
  });
});
