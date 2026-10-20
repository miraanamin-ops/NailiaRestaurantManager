// supabase/042_forecast_briefs.sql on the full migration chain in PGlite: it runs
// again safely, the demo-only forecast setting is refused on a real restaurant,
// one brief row per restaurant per day, and its rollback undoes it.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb, readMigration } from "./support/full-pg";

const REAL = "a0a0a0a0-0000-0000-0000-000000000001";
const DEMO = "b0b0b0b0-0000-0000-0000-000000000002";

const one = async <T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];

let pg: PGlite;
beforeAll(async () => {
  pg = await newFullDb();
  await pg.query("insert into restaurants (id, name, is_demo) values ($1, 'Real', false), ($2, 'Demo', true)", [REAL, DEMO]);
}, 120_000);

describe("042_forecast_briefs.sql", () => {
  test("records itself and runs again safely", async () => {
    expect(await one(pg, "select count(*)::int as n from schema_migrations where name = '042_forecast_briefs.sql'")).toEqual({ n: 1 });
    await pg.exec(readMigration("042_forecast_briefs.sql"));
    expect(await one(pg, "select count(*)::int as n from schema_migrations where name = '042_forecast_briefs.sql'")).toEqual({ n: 1 });
  });

  test("unvalidated forecasts can be switched on for a demo restaurant, never a real one", async () => {
    await pg.query("update restaurants set forecast_unvalidated = true where id = $1", [DEMO]);
    expect(await one(pg, "select forecast_unvalidated from restaurants where id = $1", [DEMO])).toEqual({ forecast_unvalidated: true });
    await expect(pg.query("update restaurants set forecast_unvalidated = true where id = $1", [REAL])).rejects.toThrow(/forecast_unvalidated_demo_only/);
    // Nor by turning a demo restaurant real while it's on.
    await expect(pg.query("update restaurants set is_demo = false where id = $1", [DEMO])).rejects.toThrow(/forecast_unvalidated_demo_only/);
    await pg.query("update restaurants set forecast_unvalidated = false where id = $1", [DEMO]);
  });

  test("one brief row per restaurant per day, with row level security on", async () => {
    await pg.query("insert into forecast_briefs (restaurant_id, day, status) values ($1, '2026-10-20', 'shown')", [REAL]);
    await expect(pg.query("insert into forecast_briefs (restaurant_id, day, status) values ($1, '2026-10-20', 'none')", [REAL])).rejects.toThrow(/duplicate/);
    await expect(pg.query("insert into forecast_briefs (restaurant_id, day, status) values ($1, '2026-10-21', 'maybe')", [REAL])).rejects.toThrow(/check/);
    expect(await one(pg, "select relrowsecurity as rls from pg_class where relname = 'forecast_briefs'")).toEqual({ rls: true });
    expect(await one(pg, "select count(*)::int as n from pg_policies where tablename = 'forecast_briefs'")).toEqual({ n: 1 });
  });

  test("the rollback removes it, and the file then runs again", async () => {
    const db = await newFullDb();
    await db.exec(readFileSync("supabase/rollback/forecast_briefs_rollback.sql", "utf8"));
    expect(await one(db, "select to_regclass('public.forecast_briefs') as t")).toEqual({ t: null });
    expect(await one(db, "select count(*)::int as n from information_schema.columns where table_name = 'restaurants' and column_name = 'forecast_unvalidated'")).toEqual({ n: 0 });
    await db.exec(readMigration("042_forecast_briefs.sql"));
    expect(await one(db, "select to_regclass('public.forecast_briefs') is not null as t")).toEqual({ t: true });
  }, 120_000);
});
