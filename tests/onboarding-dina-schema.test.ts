// supabase/048_onboarding_dina.sql on a real Postgres (PGlite, every migration
// from setup.sql on): it runs and re-runs, a test site must be a demo, owners
// read only their own setup (Row Level Security) and can't write it, deleting a
// restaurant deletes its setup, and the rollback undoes it all.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb, readMigration } from "./support/full-pg";

const A = "a0000000-0000-0000-0000-00000000048a";
const B = "b0000000-0000-0000-0000-00000000048b";
const TABLES = ["onboarding_sessions", "onboarding_steps", "onboarding_messages", "setup_gaps"];
const json = (v: unknown) => JSON.stringify(v);

let pg: PGlite;
const rows = async (sql: string, params: unknown[] = []) => (await pg.query<Record<string, unknown>>(sql, params)).rows;

async function as<T>(role: string, email: string | null, fn: () => Promise<T>) {
  await pg.exec(`set role ${role}`);
  await pg.query("select set_config('request.jwt.claims', $1, false)", [email ? json({ email }) : ""]);
  try {
    return await fn();
  } finally {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claims', '', false)");
  }
}

async function seed(id: string, email: string) {
  await pg.query("insert into restaurants (id, name, owner_email) values ($1, $2, $3)", [id, `R ${id.slice(0, 2)}`, email]);
  await pg.query("insert into onboarding_sessions (restaurant_id, current_step) values ($1, 'google')", [id]);
  await pg.query("insert into onboarding_steps (restaurant_id, step_key, status, data) values ($1, 'hello', 'done', '{\"owner_name\": \"x\"}')", [id]);
  await pg.query("insert into onboarding_messages (restaurant_id, role, channel, body, external_id) values ($1, 'dina', 'web', 'Hello, I''m Dina', 'SM1')", [id]);
  await pg.query("insert into setup_gaps (restaurant_id, step_key, unlock_text) values ($1, 'google', 'Connect Google and ...')", [id]);
}

beforeAll(async () => {
  pg = await newFullDb();
  await seed(A, "a@owner.test");
  await seed(B, "b@owner.test");
}, 180_000);

describe("the migration", () => {
  test("is recorded and safe to run again", async () => {
    expect(await rows("select name from schema_migrations where name = '048_onboarding_dina.sql'")).toHaveLength(1);
    await pg.exec(readMigration("048_onboarding_dina.sql"));
    expect(await rows("select restaurant_id from onboarding_sessions order by restaurant_id")).toEqual([{ restaurant_id: A }, { restaurant_id: B }]);
  });

  test("a test site must also be a demo restaurant", async () => {
    await expect(pg.query("update restaurants set is_test = true, is_demo = false where id = $1", [A])).rejects.toThrow(/restaurants_test_is_demo/);
    await pg.query("update restaurants set is_test = true, is_demo = true where id = $1", [A]);
    await expect(pg.query("update restaurants set is_demo = false where id = $1", [A])).rejects.toThrow(/restaurants_test_is_demo/);
    await pg.query("update restaurants set is_test = false, is_demo = false where id = $1", [A]);
  });

  test("one row per step, a known status, and a repeated WhatsApp message is saved once", async () => {
    await expect(pg.query("insert into onboarding_steps (restaurant_id, step_key) values ($1, 'hello')", [A])).rejects.toThrow(/duplicate key/);
    await expect(pg.query("insert into onboarding_steps (restaurant_id, step_key, status) values ($1, 'tone', 'finished')", [A])).rejects.toThrow(/check constraint/);
    await expect(pg.query("insert into onboarding_messages (restaurant_id, role, channel, external_id) values ($1, 'owner', 'whatsapp', 'SM1')", [A])).rejects.toThrow(/duplicate key/);
    // The same Twilio id at another restaurant is a different message.
    await pg.query("insert into onboarding_messages (restaurant_id, role, channel, external_id) values ($1, 'owner', 'whatsapp', 'SM1-b')", [B]);
    await expect(pg.query("insert into setup_gaps (restaurant_id, step_key, unlock_text) values ($1, 'google', 'again')", [A])).rejects.toThrow(/duplicate key/);
  });

  test("invite codes have a type: pilot by default, or standard", async () => {
    await pg.query("insert into pilot_invites (code) values ('PILOT-48')");
    await pg.query("insert into pilot_invites (code, type) values ('STD-48', 'standard')");
    expect(await rows("select code, type from pilot_invites where code in ('PILOT-48', 'STD-48') order by code")).toEqual([
      { code: "PILOT-48", type: "pilot" },
      { code: "STD-48", type: "standard" },
    ]);
    await expect(pg.query("insert into pilot_invites (code, type) values ('BAD-48', 'vip')")).rejects.toThrow(/check constraint/);
  });
});

describe("Row Level Security", () => {
  test("an owner reads only their own restaurant's setup", async () => {
    await as("authenticated", "A@Owner.test", async () => {
      for (const t of TABLES) expect((await rows(`select distinct restaurant_id from ${t}`)).map((r) => r.restaurant_id)).toEqual([A]);
    });
    await as("authenticated", "b@owner.test", async () => {
      for (const t of TABLES) expect((await rows(`select distinct restaurant_id from ${t}`)).map((r) => r.restaurant_id)).toEqual([B]);
    });
  });

  test("owners can't write their setup (only the server can), and nobody logged out sees anything", async () => {
    await as("authenticated", "a@owner.test", async () => {
      await expect(pg.query("insert into onboarding_steps (restaurant_id, step_key, status) values ($1, 'tone', 'done')", [A])).rejects.toThrow(/row-level security/);
      expect((await pg.query("update onboarding_steps set status = 'skipped' where restaurant_id = $1", [A])).affectedRows).toBe(0);
      expect((await pg.query("update setup_gaps set dismissed = true where restaurant_id = $1", [B])).affectedRows).toBe(0);
      expect((await pg.query("delete from onboarding_messages where restaurant_id = $1", [A])).affectedRows).toBe(0);
    });
    await as("anon", null, async () => {
      for (const t of TABLES) expect(await rows(`select * from ${t}`)).toEqual([]);
    });
    expect(await rows("select status from onboarding_steps where restaurant_id = $1 and step_key = 'hello'", [A])).toEqual([{ status: "done" }]);
  });
});

describe("deleting and rolling back", () => {
  test("deleting a restaurant (e.g. a test site) deletes all its setup and nothing else", async () => {
    const C = "c0000000-0000-0000-0000-00000000048c";
    await seed(C, "c@owner.test");
    await pg.query("delete from restaurants where id = $1", [C]);
    for (const t of TABLES) {
      expect(await rows(`select 1 from ${t} where restaurant_id = $1`, [C])).toEqual([]);
      expect((await rows(`select 1 from ${t} where restaurant_id = $1`, [A])).length).toBeGreaterThan(0);
    }
  });

  test("the rollback removes it all, and 048 can be run again afterwards", async () => {
    await pg.exec(readFileSync(new URL("../supabase/rollback/onboarding_dina_rollback.sql", import.meta.url), "utf8"));
    expect(await rows("select table_name from information_schema.tables where table_name = any($1)", [TABLES])).toEqual([]);
    expect(await rows("select column_name from information_schema.columns where table_name = 'restaurants' and column_name in ('is_test', 'privacy_version', 'dpa_version')")).toEqual([]);
    expect(await rows("select 1 from schema_migrations where name = '048_onboarding_dina.sql'")).toEqual([]);
    await pg.exec(readMigration("048_onboarding_dina.sql"));
    expect((await rows("select table_name from information_schema.tables where table_name = any($1)", [TABLES])).length).toBe(4);
  });
});
