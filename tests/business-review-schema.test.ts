// supabase/058_business_review.sql on the full migration chain in PGlite: it
// records itself and runs again safely, one review per restaurant, the new draft
// kind, row-level security on, the job types, and the rollback undoes it.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb, readMigration } from "./support/full-pg";

const one = async <T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
const ID = "a0a0a0a0-0000-0000-0000-000000000058";

let pg: PGlite;
beforeAll(async () => {
  pg = await newFullDb();
}, 120_000);

describe("058_business_review.sql", () => {
  test("records itself and runs again safely", async () => {
    await pg.exec(readMigration("058_business_review.sql"));
    expect(await one(pg, "select count(*)::int as n from schema_migrations where name = '058_business_review.sql'")).toEqual({ n: 1 });
  });

  test("one review per restaurant; parts once per review; time saved once per action", async () => {
    await pg.query("insert into restaurants (id, name, is_demo) values ($1, 'Review', true)", [ID]);
    const { id } = (await one<{ id: string }>(pg, "insert into business_reviews (restaurant_id) values ($1) returning id", [ID]))!;
    await expect(pg.query("insert into business_reviews (restaurant_id) values ($1)", [ID])).rejects.toThrow(/duplicate/);
    await pg.query("insert into business_review_parts (review_id, restaurant_id, part) values ($1, $2, 'rivals')", [id, ID]);
    await expect(pg.query("insert into business_review_parts (review_id, restaurant_id, part) values ($1, $2, 'rivals')", [id, ID])).rejects.toThrow(/duplicate/);
    await pg.query("insert into time_saved_log (restaurant_id, action, ref, minutes) values ($1, 'poster', 'x', 30)", [ID]);
    await expect(pg.query("insert into time_saved_log (restaurant_id, action, ref, minutes) values ($1, 'poster', 'x', 30)", [ID])).rejects.toThrow(/duplicate/);
    await expect(pg.query("update business_reviews set status = 'nonsense' where id = $1", [id])).rejects.toThrow(/check/);
  });

  test("profile_fix drafts are allowed, and remember their review", async () => {
    const { id } = (await one<{ id: string }>(pg, "select id from business_reviews where restaurant_id = $1", [ID]))!;
    await pg.query("insert into drafts (restaurant_id, kind, content, status, business_review_id) values ($1, 'profile_fix', 'Add your menu link', 'pending', $2)", [ID, id]);
    expect(await one(pg, "select count(*)::int as n from drafts where business_review_id = $1", [id])).toEqual({ n: 1 });
  });

  test("row-level security on every new table, and the job types are there", async () => {
    const rls = await pg.query<{ relname: string; rls: boolean }>(
      "select relname, relrowsecurity as rls from pg_class where relname in ('business_reviews','business_review_parts','review_tags','rival_places','calendar_events','time_saved_log') order by relname",
    );
    expect(rls.rows.every((r) => r.rls)).toBe(true);
    expect(rls.rows).toHaveLength(6);
    const types = await pg.query<{ type: string }>("select type from job_types where type like 'business_review%' or type = 'review_reply_release' order by type");
    expect(types.rows.map((r) => r.type)).toEqual(["business_review", "business_review_part", "business_review_receipt", "business_review_send", "review_reply_release"]);
  });

  test("the rollback undoes 058", async () => {
    await pg.query("delete from drafts where kind = 'profile_fix'");
    await pg.exec(readFileSync(new URL("../supabase/rollback/business_review_rollback.sql", import.meta.url), "utf8"));
    expect(await one(pg, "select to_regclass('business_reviews') as t")).toEqual({ t: null });
    expect(await one(pg, "select count(*)::int as n from schema_migrations where name = '058_business_review.sql'")).toEqual({ n: 0 });
    expect(await one(pg, "select count(*)::int as n from information_schema.columns where table_name = 'restaurants' and column_name = 'event_audiences'")).toEqual({ n: 0 });
  });
});
