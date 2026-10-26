// supabase/043_pilot_rota.sql and supabase/seed/test-kitchen.sql on the full
// migration chain in PGlite: the migration runs again safely, rota rules are one
// per role, the seed makes Test Kitchen with 12 months of sales and 8 staff,
// running it again changes nothing, it refuses a real restaurant, and the
// rollback undoes the migration.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb, readMigration } from "./support/full-pg";
import { DUMMY_RULES, DUMMY_STAFF } from "@/lib/rota/types";
import { DUMMY_PROFILE } from "@/lib/forecast/week-ahead-rules";

const TK = "7e57c0de-0000-4000-8000-000000000000";
const SEED = readFileSync(new URL("../supabase/seed/test-kitchen.sql", import.meta.url), "utf8");

const one = async <T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];

// The dev project's mark (analytics/generator/apply_migrations.py mark_dev); the live database never has it.
const markDev = (db: PGlite, mark: string | null) =>
  db.exec(`do $$ begin execute format('comment on database %I is %s', current_database(), ${mark === null ? "'null'" : `quote_literal('${mark}')`}); end $$;`);

let pg: PGlite;
beforeAll(async () => {
  pg = await newFullDb();
  await markDev(pg, "dinerai-dev: the DinerAI dev project (demo data allowed)");
}, 120_000);

describe("043_pilot_rota.sql", () => {
  test("records itself and runs again safely", async () => {
    await pg.exec(readMigration("043_pilot_rota.sql"));
    expect(await one(pg, "select count(*)::int as n from schema_migrations where name = '043_pilot_rota.sql'")).toEqual({ n: 1 });
  });

  test("one rule per role per restaurant, with row level security on", async () => {
    const id = "a0a0a0a0-0000-0000-0000-000000000043";
    await pg.query("insert into restaurants (id, name, is_demo) values ($1, 'Rules', true)", [id]);
    await pg.query("insert into rota_rules (restaurant_id, role, min_on_shift) values ($1, 'kitchen', 2)", [id]);
    await expect(pg.query("insert into rota_rules (restaurant_id, role) values ($1, 'kitchen')", [id])).rejects.toThrow(/duplicate/);
    await expect(pg.query("insert into rota_rules (restaurant_id, role, orders_per_extra_staff) values ($1, 'front', 0)", [id])).rejects.toThrow(/check/);
    expect(await one(pg, "select relrowsecurity as rls from pg_class where relname = 'rota_rules'")).toEqual({ rls: true });
  });
});

describe("seed/test-kitchen.sql", () => {
  test("refuses any database without the dev mark (the live one never has it), changing nothing", async () => {
    for (const mark of [null, "default administrative connection database", "live dinerai-dev"]) {
      await markDev(pg, mark);
      await expect(pg.exec(SEED)).rejects.toThrow(/not the dev database/);
      expect(await one(pg, "select count(*)::int as n from restaurants where id = $1", [TK])).toEqual({ n: 0 });
    }
    await markDev(pg, "dinerai-dev: the DinerAI dev project (demo data allowed)");
  });

  test("makes Test Kitchen: a demo restaurant, not active, with its menu in dishes", async () => {
    await pg.exec(SEED);
    expect(await one(pg, "select name, slug, is_demo, active from restaurants where id = $1", [TK])).toEqual({ name: "Test Kitchen", slug: "test-kitchen", is_demo: true, active: false });
    expect(await one(pg, "select count(*)::int as n from dishes where restaurant_id = $1", [TK])).toEqual({ n: 7 });
  });

  test("12 months of dummy daily and hourly sales, up to yesterday", async () => {
    const d = await one<{ n: number; first: string; last: string; dummy: number }>(
      pg,
      "select count(*)::int as n, min(day)::text as first, max(day)::text as last, count(*) filter (where is_dummy)::int as dummy from sales_days where restaurant_id = $1",
      [TK],
    );
    expect(d.n).toBe(365);
    expect(d.dummy).toBe(365);
    expect(d.last).toBe((await one<{ y: string }>(pg, "select (current_date - 1)::text as y")).y);
    // Hours add up to the day (within rounding), and Friday and Saturday have the extra hour.
    const h = await one<{ off: number; late: number }>(
      pg,
      `select max(abs(s.gross_sales - x.total))::float as off,
              count(*) filter (where x.hours = 11 and extract(isodow from s.day) not in (5, 6))::int as late
         from sales_days s join (select day, sum(sales) as total, count(*) as hours from sales_hours where restaurant_id = $1 group by day) x using (day)
        where s.restaurant_id = $1`,
      [TK],
    );
    expect(h.off).toBeLessThan(0.1);
    expect(h.late).toBe(0);
    // Saturdays busier than Tuesdays, as the dummy forecast says.
    const w = await one<{ sat: number; tue: number }>(
      pg,
      `select avg(transactions) filter (where extract(isodow from day) = 6)::float as sat,
              avg(transactions) filter (where extract(isodow from day) = 2)::float as tue
         from sales_days where restaurant_id = $1`,
      [TK],
    );
    expect(w.sat / w.tue).toBeCloseTo(DUMMY_PROFILE.orders[5] / DUMMY_PROFILE.orders[1], 0);
  });

  test("8 staff across kitchen and front of house, matching the dummy rota inputs", async () => {
    const staff = (
      await pg.query<{ name: string; roles: string[]; max: string; pence: number; days: number }>(
        `select s.display_name as name, s.roles, s.max_hours_week::text as max, p.hourly_pence as pence,
                (select count(*)::int from staff_availability a where a.staff_id = s.id) as days
           from staff s join staff_pay_rates p on p.staff_id = s.id
          where s.restaurant_id = $1 order by s.id`,
        [TK],
      )
    ).rows;
    expect(staff).toHaveLength(8);
    expect(staff.filter((s) => s.roles.includes("kitchen"))).toHaveLength(5);
    expect(staff.filter((s) => s.roles.includes("front"))).toHaveLength(4);
    expect(staff.map((s) => ({ name: s.name, roles: s.roles, max: Number(s.max), pence: s.pence }))).toEqual(
      DUMMY_STAFF.map((s) => ({ name: s.name, roles: s.roles, max: s.max_hours_week, pence: s.hourly_rate_pence })),
    );
    expect(staff.map((s) => s.days)).toEqual(DUMMY_STAFF.map((s) => Object.values(s.availability).filter((a) => a.length).length));
    const rules = (await pg.query("select role, min_on_shift, orders_per_extra_staff::float as orders_per_extra_staff from rota_rules where restaurant_id = $1 order by role desc", [TK])).rows;
    expect(rules).toEqual(DUMMY_RULES);
  });

  test("dummy Google reviews", async () => {
    expect(await one(pg, "select count(*)::int as n from reviews where restaurant_id = $1", [TK])).toEqual({ n: 4 });
  });

  test("4 weeks of past approved rotas, before this week, in London time", async () => {
    expect(await one(pg, "select count(*)::int as n, bool_and(status = 'approved') as ok, max(week_start) < date_trunc('week', current_date)::date as past from rota_weeks where restaurant_id = $1", [TK])).toEqual({ n: 4, ok: true, past: true });
    // Mon to Thu: Tomasz, Ravi, Sam; Fri and Sat: 5 people; Sun: 3 = 4*3 + 2*5 + 3 = 25 shifts a week
    expect(await one(pg, "select count(*)::int as n from rota_shifts where restaurant_id = $1", [TK])).toEqual({ n: 100 });
    expect(await one(pg, "select to_char(starts_at at time zone 'Europe/London', 'HH24:MI') as t from rota_shifts where restaurant_id = $1 and staff_id = $2 limit 1", [TK, `${TK.slice(0, -1)}2`])).toEqual({ t: "12:00" });
  });

  test("running it again changes nothing", async () => {
    const count = async () =>
      one(pg, `select (select count(*) from sales_days where restaurant_id = $1)::int as days, (select count(*) from sales_hours where restaurant_id = $1)::int as hours,
                      (select count(*) from staff where restaurant_id = $1)::int as staff, (select count(*) from staff_availability where restaurant_id = $1)::int as avail,
                      (select count(*) from rota_weeks where restaurant_id = $1)::int as rotas, (select count(*) from rota_shifts where restaurant_id = $1)::int as shifts,
                      (select count(*) from staff_pay_rates where restaurant_id = $1)::int as pay, (select count(*) from reviews where restaurant_id = $1)::int as reviews,
                      (select sum(net_sales) from sales_days where restaurant_id = $1)::text as net`, [TK]);
    const before = await count();
    await pg.exec(SEED);
    expect(await count()).toEqual(before);
  });

  test("refuses when a real restaurant has its slug", async () => {
    await pg.query("delete from restaurants where id = $1", [TK]);
    await pg.query("insert into restaurants (id, name, slug, is_demo) values ('a0a0a0a0-0000-0000-0000-0000000000aa', 'Real', 'test-kitchen', false)");
    await expect(pg.exec(SEED)).rejects.toThrow(/not the Test Kitchen demo/);
    await pg.query("delete from restaurants where slug = 'test-kitchen'");
  });

  test("refuses when another demo restaurant has its id, and leaves that one's data alone", async () => {
    await pg.query("insert into restaurants (id, name, slug, is_demo) values ($1, 'Other demo', 'other-demo', true)", [TK]);
    await pg.query("insert into sales_days (restaurant_id, day, net_sales, source, is_dummy) values ($1, current_date - 3, 100, 'seed', true)", [TK]);
    await expect(pg.exec(SEED)).rejects.toThrow(/not the Test Kitchen demo/);
    expect(await one(pg, "select count(*)::int as n, sum(net_sales)::int as net from sales_days where restaurant_id = $1", [TK])).toEqual({ n: 1, net: 100 });
    await pg.query("delete from restaurants where id = $1", [TK]);
  });

  test("the rollback undoes 043", async () => {
    await pg.exec(readFileSync(new URL("../supabase/rollback/pilot_rota_rollback.sql", import.meta.url), "utf8"));
    expect(await one(pg, "select to_regclass('public.rota_rules') is null as gone")).toEqual({ gone: true });
    expect(await one(pg, "select count(*)::int as n from information_schema.columns where table_name = 'staff' and column_name = 'max_hours_week'")).toEqual({ n: 0 });
    await pg.exec(readMigration("043_pilot_rota.sql"));
  });
});
