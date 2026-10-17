// The operations data (supabase/030 to 037) on a real Postgres: a fresh database
// built from setup.sql and every migration, in PGlite. Checks the migrations run
// (and re-run, and roll back), the menu move changes nothing anyone reads, how
// saving a menu keeps dishes (renames included), the guard, clock-change hours,
// "known at the time" weather, Row Level Security and the roles, and that the
// demo clear-out removes everything synthetic and nothing real.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migrationFiles, newFullDb, readMigration } from "./support/full-pg";
import { OWNED_TABLES } from "./support/owned-tables";
import { customerSafeMenu, findItem, menuItemCount, type MenuCategory } from "@/lib/onboarding/profile-data";
import { cheapestFor, findDish, offerCap } from "@/lib/offers";
import { unknownPrices } from "@/lib/prices";
import { londonHourSpan, londonHoursOf } from "@/lib/ops/hours";

const EMBER = "11111111-1111-1111-1111-111111111111";
const CARDAMOM = "22222222-2222-2222-2222-222222222222";
const OPS_FILES = migrationFiles().filter((f) => /^03[0-7]_/.test(f));
const GLOBAL_TABLES = ["venues", "football_fixtures"];

type Q = Pick<PGlite, "query" | "exec">;
const one = async <T = Record<string, unknown>>(pg: Q, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
const all = async <T = Record<string, unknown>>(pg: Q, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const json = (v: unknown) => JSON.stringify(v);

async function newRestaurant(pg: Q, id: string, menu: MenuCategory[] | unknown = [], extra: { email?: string; demo?: boolean } = {}) {
  await pg.query("insert into restaurants (id, name, menu, owner_email, is_demo) values ($1, $2, $3::jsonb, $4, $5)", [
    id,
    `R ${id.slice(0, 4)}`,
    json(menu),
    extra.email ?? null,
    extra.demo ?? false,
  ]);
}
const saveMenu = async (pg: Q, id: string, menu: unknown, renames: unknown[] = [], today?: string) =>
  (await one<{ m: MenuCategory[] }>(pg, "select save_menu($1, $2::jsonb, 'manual', $3::jsonb, $4::date) as m", [id, json(menu), json(renames), today ?? null])).m;
const withIds = async (pg: Q, id: string) => (await one<{ m: MenuCategory[] }>(pg, "select menu_json($1, true) as m", [id])).m;
const dishIdOf = async (pg: Q, rid: string, name: string) =>
  (await one<{ id: string }>(pg, "select id from dishes where restaurant_id = $1 and name = $2 and active_to is null", [rid, name]))?.id;

let pg: PGlite;
let before: Record<string, MenuCategory[]>;

beforeAll(async () => {
  // The database just before the move, to compare the menus with afterwards.
  pg = await newFullDb({ upTo: "028_queue_schedule.sql" });
  before = Object.fromEntries((await all<{ id: string; menu: MenuCategory[] }>(pg, "select id, menu from restaurants")).map((r) => [r.id, r.menu]));
  for (const f of OPS_FILES) await pg.exec(readMigration(f));
}, 120_000);

describe("the migrations", () => {
  test("every file records itself, and all of them run again safely", async () => {
    const names = (await all<{ name: string }>(pg, "select name from schema_migrations")).map((r) => r.name);
    for (const f of OPS_FILES) expect(names).toContain(f);
    const dishes = await one<{ n: number }>(pg, "select count(*)::int as n from dishes");
    for (const f of OPS_FILES) await pg.exec(readMigration(f));
    expect(await one(pg, "select count(*)::int as n from dishes")).toEqual(dishes);
    for (const [id, menu] of Object.entries(before)) expect((await one<{ menu: unknown }>(pg, "select menu from restaurants where id = $1", [id])).menu).toEqual(menu);
  });

  test("every new table carries restaurant_id (or is a shared one), has RLS on with policies, and is in the isolation scan", async () => {
    const old = await newFullDb({ upTo: "028_queue_schedule.sql" });
    const oldTables = new Set((await all<{ t: string }>(old, "select tablename as t from pg_tables where schemaname = 'public'")).map((r) => r.t));
    const newTables = (await all<{ t: string }>(pg, "select tablename as t from pg_tables where schemaname = 'public'")).map((r) => r.t).filter((t) => !oldTables.has(t));
    expect(newTables.length).toBeGreaterThan(30);
    for (const t of newTables) {
      const hasRid = await one<{ n: number }>(pg, "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'restaurant_id'", [t]);
      if (GLOBAL_TABLES.includes(t)) expect(hasRid.n, t).toBe(0);
      else {
        expect(hasRid.n, `${t} has restaurant_id`).toBe(1);
        expect(OWNED_TABLES, `${t} is in tests/support/owned-tables.ts`).toContain(t);
      }
      const rls = await one<{ on: boolean }>(pg, "select relrowsecurity as on from pg_class where relname = $1 and relnamespace = 'public'::regnamespace", [t]);
      expect(rls.on, `${t} has RLS on`).toBe(true);
      const policies = await one<{ n: number }>(pg, "select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1", [t]);
      if (t !== "menu_json_backup") expect(policies.n, `${t} has policies`).toBeGreaterThan(0);
    }
  }, 60_000);

  test("the rollback removes it all, keeps the menus, and the migrations then run again", async () => {
    const db = await newFullDb();
    const menus = await all(db, "select id, menu from restaurants order by id");
    await db.exec(readFileSync("supabase/rollback/ops_rollback.sql", "utf8"));
    for (const t of ["dishes", "staff", "forecasts", "weather_forecasts", "menu_json_backup", "venues"]) {
      expect(await one(db, "select to_regclass($1) as t", [`public.${t}`])).toEqual({ t: null });
    }
    expect(await one(db, "select to_regnamespace('analytics') as s")).toEqual({ s: null });
    expect(await all(db, "select id, menu from restaurants order by id")).toEqual(menus);
    expect(await one<{ n: number }>(db, "select count(*)::int as n from schema_migrations where name like '03%_ops_%'")).toEqual({ n: 0 });
    // Writing the menu directly works again (the guard is gone)...
    await db.query("update restaurants set menu = '[]'::jsonb where id = $1", [EMBER]);
    await db.query("update restaurants set menu = $2::jsonb where id = $1", [EMBER, json(menus.find((m) => m.id === EMBER)!.menu)]);
    // ...and the step can be run again from scratch.
    for (const f of OPS_FILES) await db.exec(readMigration(f));
    expect(await one<{ n: number }>(db, "select count(*)::int as n from dishes where restaurant_id = $1", [EMBER])).toEqual({ n: 13 });
  }, 120_000);
});

describe("moving the menu into dishes", () => {
  test("every existing restaurant's menu is identical before and after", async () => {
    expect(Object.keys(before).length).toBe(2);
    for (const [id, menu] of Object.entries(before)) {
      const after = await one<{ menu: MenuCategory[]; generated: MenuCategory[]; backup: MenuCategory[] }>(
        pg,
        "select r.menu, menu_json(r.id) as generated, b.menu as backup from restaurants r join menu_json_backup b on b.restaurant_id = r.id where r.id = $1",
        [id],
      );
      expect(after.menu).toEqual(menu);
      expect(after.generated).toEqual(menu);
      expect(after.backup).toEqual(menu);
      expect(JSON.stringify(after.generated)).toBe(JSON.stringify(menu)); // same key order too
    }
  });

  test("every menu reader gives the same answer from the menu made from dishes", async () => {
    for (const [id, menuBefore] of Object.entries(before)) {
      const menuAfter = (await one<{ menu: MenuCategory[] }>(pg, "select menu_json($1) as menu", [id])).menu;
      const readers = (m: MenuCategory[]) => ({
        safe: customerSafeMenu(m),
        count: menuItemCount(m),
        firstDish: findItem(m, m[0].items[0].name),
        findDish: findDish(m, m[1].items[0].name.toLowerCase()),
        cheapestMain: cheapestFor(m, "any main"),
        cap: offerCap({ type: "free_item", applies_to: m[0].items[0].name, discount_percent: null, discount_value_gbp: null, description: "A free drink" }, m, 25),
        prices: unknownPrices(`Only £${m[0].items[0].price.toFixed(2)} or £99.99`, { menu: m }),
        promptLine: m.flatMap((c) => c.items.map((i) => `${i.name} £${i.price.toFixed(2)}`)).join(", "),
      });
      expect(readers(menuAfter)).toEqual(readers(menuBefore));
    }
  });

  test("odd menus survive exactly: empty sections, the same name twice, missing and unknown keys, odd prices", async () => {
    const db = await newFullDb({ upTo: "028_queue_schedule.sql" });
    const odd = [
      { category: "Starters", items: [
        { name: "Samosa", price: 3.5, description: "Two", allergens: ["cereals containing gluten"], allergens_confirmed: true },
        { name: "Samosa", price: 4, description: null },
      ] },
      { category: "Empty", items: [] },
      { category: "Odd", note: "chef's picks", items: [
        { name: "Tea", price: "2.50" },
        { name: "Cake", price: 3.999, spicy: true },
        { name: "Water" },
        { name: "Juice", price: null, description: null, allergens: [], allergens_confirmed: false },
        { name: 7, price: -1 },
      ] },
      { items: [{ name: "No section", price: 1 }] },
    ];
    await newRestaurant(db, "33333333-3333-3333-3333-333333333333", odd);
    await newRestaurant(db, "44444444-4444-4444-4444-444444444444", []);
    for (const f of OPS_FILES) await db.exec(readMigration(f));
    const got = await one<{ menu: unknown; generated: unknown }>(db, "select menu, menu_json(id) as generated from restaurants where id = '33333333-3333-3333-3333-333333333333'");
    expect(got.menu).toEqual(odd);
    expect(got.generated).toEqual(odd);
    expect((await one(db, "select menu_json('44444444-4444-4444-4444-444444444444') as m")).m).toEqual([]);
    // Each Samosa is its own dish, with its own price.
    expect(await all(db, "select d.name, p.price_pence from dishes d join dish_prices p on p.dish_id = d.id where d.name = 'Samosa' order by d.position")).toEqual([
      { name: "Samosa", price_pence: 350 },
      { name: "Samosa", price_pence: 400 },
    ]);
  }, 120_000);

  test("a menu it can't read stops the move and saves nothing", async () => {
    const db = await newFullDb({ upTo: "030_ops_foundation.sql" });
    await newRestaurant(db, "55555555-5555-5555-5555-555555555555", ["not a section"]);
    await expect(db.exec(readMigration("031_ops_menu.sql"))).rejects.toThrow(/section 1 is not an object/);
    await db.exec("rollback").catch(() => undefined);
    expect(await one(db, "select to_regclass('public.dishes') as t")).toEqual({ t: null });
    expect(await one<{ n: number }>(db, "select count(*)::int as n from schema_migrations where name = '031_ops_menu.sql'")).toEqual({ n: 0 });
  }, 120_000);
});

describe("saving a menu keeps each dish", () => {
  const R = "66666666-6666-6666-6666-666666666666";
  const menu = (over: Partial<Record<string, unknown>> = {}) => [
    { category: "Grill", items: [
      { name: "Chicken Tikka", price: 11, description: "Six pieces", allergens: ["milk"], allergens_confirmed: true, ...over },
      { name: "Lamb Chops", price: 14, description: null, allergens: [], allergens_confirmed: false },
    ] },
    { category: "Sides", items: [{ name: "Naan", price: 2.5, description: null, allergens: [], allergens_confirmed: false }] },
  ];

  beforeAll(async () => {
    // Made after 037: the menu it arrives with goes straight into dishes.
    await newRestaurant(pg, R, menu(), { email: "six@owner.test" });
    // As if it had been on the menu since January (the tests below save menus on dates from June).
    await pg.query("update dish_prices set effective_from = '2026-01-01', recorded_at = '2026-01-01T09:00:00Z' where restaurant_id = $1", [R]);
    await pg.query("update dishes set active_from = '2026-01-01' where restaurant_id = $1", [R]);
    await pg.query("update menu_sections set active_from = '2026-01-01' where restaurant_id = $1", [R]);
    // A recipe and a till match for Chicken Tikka, and a till sale under its till name.
    const tikka = await dishIdOf(pg, R, "Chicken Tikka");
    const ing = await one<{ id: string }>(pg, "insert into ingredients (restaurant_id, name, unit) values ($1, 'Chicken thigh', 'g') returning id", [R]);
    const rv = await one<{ id: string }>(pg, "insert into recipe_versions (restaurant_id, dish_id, effective_from) values ($1, $2, '2026-01-01') returning id", [R, tikka]);
    await pg.query("insert into recipe_lines (restaurant_id, recipe_version_id, ingredient_id, quantity, waste_pct) values ($1, $2, $3, 180, 10)", [R, rv.id, ing.id]);
    await pg.query("insert into till_item_matches (restaurant_id, till_name, dish_id, confidence, method) values ($1, 'Chkn Tikka', $2, 0.9, 'fuzzy')", [R, tikka]);
    await pg.query("insert into sales_items (restaurant_id, day, item, quantity, amount, row_key) values ($1, '2026-02-01', 'CHKN  TIKKA', 2, 22, 'k1')", [R]);
  });

  test("a new restaurant's menu went into dishes", async () => {
    expect((await one(pg, "select menu_json($1) as m", [R])).m).toEqual(menu());
    expect(await one<{ n: number }>(pg, "select count(*)::int as n from dishes where restaurant_id = $1", [R])).toEqual({ n: 3 });
  });

  test("a price change is a new price row; the old price stays for its dates", async () => {
    const tikka = await dishIdOf(pg, R, "Chicken Tikka");
    await saveMenu(pg, R, menu({ price: 12.5 }), [], "2026-06-01");
    expect(await dishIdOf(pg, R, "Chicken Tikka")).toBe(tikka);
    expect(await one(pg, "select dish_price_on($1, '2026-05-31') as p", [tikka])).toEqual({ p: 1100 });
    expect(await one(pg, "select dish_price_on($1, '2026-06-01') as p", [tikka])).toEqual({ p: 1250 });
    // As known before the change was recorded: the old price.
    expect(await one(pg, "select dish_price_on($1, '2026-06-01', '2026-02-01T00:00:00Z') as p", [tikka])).toEqual({ p: 1100 });
    // Saving the same menu again adds nothing.
    const rows = await one(pg, "select count(*)::int as n from dish_prices where restaurant_id = $1", [R]);
    await saveMenu(pg, R, menu({ price: 12.5 }), [], "2026-06-02");
    expect(await one(pg, "select count(*)::int as n from dish_prices where restaurant_id = $1", [R])).toEqual(rows);
  });

  test("a rename from settings (with the dish's id) keeps the dish, its prices, recipe and till matches", async () => {
    const tikka = await dishIdOf(pg, R, "Chicken Tikka");
    const edited = await withIds(pg, R);
    expect(edited[0].items[0].id).toBe(tikka);
    edited[0].items[0].name = "Chicken Tikka Masala";
    const saved = await saveMenu(pg, R, edited, [], "2026-06-10");
    expect(saved[0].items[0]).not.toHaveProperty("id"); // the copy never holds ids
    expect(await dishIdOf(pg, R, "Chicken Tikka Masala")).toBe(tikka);
    expect(await one<{ n: number }>(pg, "select count(*)::int as n from dishes where restaurant_id = $1", [R])).toEqual({ n: 3 }); // no new dish
    expect(await all(pg, "select old_name, new_name from dish_renames where dish_id = $1", [tikka])).toEqual([{ old_name: "Chicken Tikka", new_name: "Chicken Tikka Masala" }]);
    expect(await one(pg, "select count(*)::int as n from dish_prices where dish_id = $1", [tikka])).toEqual({ n: 2 });
    expect(await one(pg, "select count(*)::int as n from recipe_versions where dish_id = $1", [tikka])).toEqual({ n: 1 });
    expect(await one(pg, "select dish_id from till_item_matches where restaurant_id = $1", [R])).toEqual({ dish_id: tikka });
    expect(await all(pg, "select dish_id, quantity from analytics.sales_items where restaurant_id = $1", [R])).toEqual([{ dish_id: tikka, quantity: "2.00" }]);
  });

  test("UNDO of the rename (the old menu, no ids) renames the same dish back", async () => {
    const tikka = await dishIdOf(pg, R, "Chicken Tikka Masala");
    await saveMenu(pg, R, menu({ price: 12.5 }), [], "2026-06-11");
    expect(await dishIdOf(pg, R, "Chicken Tikka")).toBe(tikka);
    expect(await one<{ n: number }>(pg, "select count(*)::int as n from dishes where restaurant_id = $1", [R])).toEqual({ n: 3 });
  });

  test("an explicit rename (a message) keeps the dish, even with no ids", async () => {
    const lamb = await dishIdOf(pg, R, "Lamb Chops");
    const m = menu({ price: 12.5 });
    m[0].items[1].name = "Lamb Cutlets";
    await saveMenu(pg, R, m, [{ from: "Lamb Chops", to: "Lamb Cutlets" }], "2026-06-12");
    expect(await dishIdOf(pg, R, "Lamb Cutlets")).toBe(lamb);
    expect(await one(pg, "select count(*)::int as n from dish_prices where dish_id = $1", [lamb])).toEqual({ n: 1 });
  });

  test("moving a dish to another section, taking it off and putting it back keep the same dish", async () => {
    const naan = await dishIdOf(pg, R, "Naan");
    const m = menu({ price: 12.5 });
    m[0].items[1].name = "Lamb Cutlets";
    const moved = [{ ...m[0], items: [...m[0].items, m[1].items[0]] }];
    await saveMenu(pg, R, moved, [], "2026-06-13");
    expect(await dishIdOf(pg, R, "Naan")).toBe(naan);
    const off = [{ ...m[0] }];
    await saveMenu(pg, R, off, [], "2026-06-14");
    expect(await one(pg, "select active_to::text as t from dishes where id = $1", [naan])).toEqual({ t: "2026-06-14" });
    expect(await one(pg, "select active_to::text as t from menu_sections where restaurant_id = $1 and name = 'Sides'", [R])).toEqual({ t: "2026-06-13" });
    await saveMenu(pg, R, m, [], "2026-06-20");
    expect(await dishIdOf(pg, R, "Naan")).toBe(naan);
    expect(await one(pg, "select active_to from dishes where id = $1", [naan])).toEqual({ active_to: null });
    expect((await one(pg, "select menu from restaurants where id = $1", [R])).menu).toEqual(m);
  });

  test("another restaurant's dish id is never taken", async () => {
    const tikka = await dishIdOf(pg, R, "Chicken Tikka");
    const other = "77777777-7777-7777-7777-777777777777";
    await newRestaurant(pg, other, []);
    await saveMenu(pg, other, [{ category: "Mains", items: [{ id: tikka, name: "Stolen", price: 1, description: null }] }]);
    expect(await dishIdOf(pg, R, "Chicken Tikka")).toBe(tikka);
    expect(await dishIdOf(pg, other, "Stolen")).not.toBe(tikka);
  });

  test("after 037 nothing else can change restaurants.menu", async () => {
    await expect(pg.query("update restaurants set menu = '[]'::jsonb where id = $1", [R])).rejects.toThrow(/made from the dishes/);
    // Writing other columns (or the same menu) is fine.
    await pg.query("update restaurants set name = 'Six' where id = $1", [R]);
    await pg.query("update restaurants set menu = menu where id = $1", [R]);
  });
});

describe("London hours in SQL match the code", () => {
  test("clock-change days: start of each hour and its length", async () => {
    for (const day of ["2026-03-29", "2026-10-25", "2026-07-01"]) {
      for (let hour = 0; hour < 24; hour++) {
        const sql = await one<{ start: Date; minutes: number }>(pg, "select london_hour_start($1::date, $2) as start, london_hour_minutes($1::date, $2) as minutes", [day, hour]);
        const code = londonHourSpan(day, hour);
        expect(sql.minutes, `${day} ${hour}`).toBe(code.minutes);
        if (code.minutes) expect(sql.start.toISOString(), `${day} ${hour}`).toBe(code.start.toISOString());
      }
      expect(londonHoursOf(day).length).toBe((await one<{ n: number }>(pg, "select sum(london_hour_minutes($1::date, h))::int / 60 as n from generate_series(0, 23) h", [day])).n);
    }
  });

  test("the hourly sales view gives the October 01:00 hour two hours", async () => {
    await pg.query("insert into sales_hours (restaurant_id, day, hour, sales, source) values ($1, '2026-10-25', 1, 120.5, 'pos')", [EMBER]);
    expect(await one(pg, "select hour_start, minutes, sales_pence_incl_vat from analytics.sales_hourly where restaurant_id = $1 and day = '2026-10-25'", [EMBER])).toEqual({
      hour_start: new Date("2026-10-25T00:00:00Z"),
      minutes: 120,
      sales_pence_incl_vat: 12050,
    });
  });
});

describe("weather known at the time", () => {
  test("never returns a forecast issued after the cut-off", async () => {
    for (const [issued, rain] of [["2026-10-10T06:00:00Z", 5], ["2026-10-11T06:00:00Z", 2], ["2026-10-12T06:00:00Z", 0]] as const) {
      await pg.query("insert into weather_forecasts (restaurant_id, issued_at, target_day, rain_mm) values ($1, $2, '2026-10-12', $3)", [EMBER, issued, rain]);
      await pg.query("insert into weather_forecasts (restaurant_id, issued_at, hour_start, rain_mm) values ($1, $2, '2026-10-12T18:00:00Z', $3)", [EMBER, issued, rain]);
    }
    const day = (cutoff: string) => one(pg, "select rain_mm::float as r from weather_known_at($1, '2026-10-12', $2)", [EMBER, cutoff]);
    expect(await day("2026-10-11T17:00:00Z")).toEqual({ r: 2 });
    expect(await day("2026-10-10T06:00:00Z")).toEqual({ r: 5 });
    expect(await day("2026-10-10T05:59:59Z")).toBeUndefined();
    expect(await one(pg, "select rain_mm::float as r from weather_hour_known_at($1, '2026-10-12T18:00:00Z', '2026-10-11T17:00:00Z')", [EMBER])).toEqual({ r: 2 });
    for (let h = 0; h < 72; h += 5) {
      const cut = new Date(Date.UTC(2026, 9, 10, h)).toISOString();
      const row = await one<{ issued_at: Date }>(pg, "select issued_at from weather_known_at($1, '2026-10-12', $2)", [EMBER, cut]);
      if (row) expect(row.issued_at.getTime()).toBeLessThanOrEqual(new Date(cut).getTime());
    }
  });
});

describe("Row Level Security and the roles", () => {
  const A = "88888888-8888-8888-8888-888888888888";
  const B = "99999999-9999-9999-9999-999999999999";
  const as = async <T>(role: string, email: string | null, fn: () => Promise<T>) => {
    await pg.exec(`set role ${role}`);
    await pg.query("select set_config('request.jwt.claims', $1, false)", [email ? json({ email }) : ""]);
    try {
      return await fn();
    } finally {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claims', '', false)");
    }
  };

  beforeAll(async () => {
    await newRestaurant(pg, A, [{ category: "A", items: [{ name: "A dish", price: 5, description: null }] }], { email: "a@owner.test" });
    await newRestaurant(pg, B, [{ category: "B", items: [{ name: "B dish", price: 6, description: null }] }], { email: "b@owner.test" });
    await pg.query("insert into staff (restaurant_id, display_name, source) values ($1, 'Aisha', 'manual'), ($2, 'Bilal', 'manual')", [A, B]);
    await pg.query("insert into venues (name, kind, latitude, longitude) values ('London Stadium', 'stadium', 51.5387, -0.0166)");
  });

  test("an owner sees and adds only their own restaurant's rows", async () => {
    await as("authenticated", "A@Owner.test", async () => {
      expect(await all(pg, "select name from dishes order by name")).toEqual([{ name: "A dish" }]);
      expect(await all(pg, "select display_name from staff")).toEqual([{ display_name: "Aisha" }]);
      await pg.query("insert into staff (restaurant_id, display_name, source) values ($1, 'Sara', 'manual')", [A]);
      await expect(pg.query("insert into staff (restaurant_id, display_name, source) values ($1, 'Intruder', 'manual')", [B])).rejects.toThrow(/row-level security/);
      // History can't be changed or deleted, and nothing is deleted through RLS.
      expect((await pg.query("update dish_prices set price_pence = 1 where restaurant_id = $1", [A])).affectedRows).toBe(0);
      expect((await pg.query("delete from staff where restaurant_id = $1", [A])).affectedRows).toBe(0);
      expect((await pg.query("update staff set display_name = 'x' where restaurant_id = $1", [B])).affectedRows).toBe(0);
      expect(await all(pg, "select name from venues")).toEqual([{ name: "London Stadium" }]);
    });
    expect(await one(pg, "select display_name from staff where restaurant_id = $1 and display_name = 'Bilal'", [B])).toEqual({ display_name: "Bilal" });
  });

  test("nobody logged out sees anything; the menu functions are closed to them", async () => {
    await as("anon", null, async () => {
      expect(await all(pg, "select * from dishes")).toEqual([]);
      expect(await all(pg, "select * from staff")).toEqual([]);
      await expect(pg.query("select save_menu($1, '[]'::jsonb)", [A])).rejects.toThrow(/permission denied/);
      await expect(pg.query("select clear_ops_dummy_data(false)")).rejects.toThrow(/permission denied/);
    });
    await as("authenticated", "a@owner.test", async () => {
      await expect(pg.query("select menu_json($1)", [B])).rejects.toThrow(/permission denied/);
      await expect(pg.query("select * from analytics.dishes")).rejects.toThrow(/permission denied/);
    });
  });

  test("model_writer adds outputs and finishes its runs, and can do nothing else", async () => {
    const run = "aaaaaaaa-1111-2222-3333-444444444444";
    await as("model_writer", null, async () => {
      await pg.query("insert into model_runs (id, restaurant_id, model_name, model_version, kind) values ($1, $2, 'sales_forecast', '0.1', 'forecast')", [run, A]);
      await pg.query("insert into forecasts (restaurant_id, model_run_id, target_day, metric, low, likely, high) values ($1, $2, '2026-10-20', 'sales_pence', 100000, 150000, 190000)", [A, run]);
      expect(await one(pg, "select finish_model_run($1, 'succeeded', '{\"wape\": 0.12}'::jsonb, 0.12, true) as ok", [run])).toEqual({ ok: true });
      expect(await one(pg, "select finish_model_run($1, 'failed') as ok", [run])).toEqual({ ok: false }); // already finished
      await expect(pg.query("update model_runs set model_name = 'x' where id = $1", [run])).rejects.toThrow(/permission denied/);
      await expect(pg.query("update forecasts set likely = 1")).rejects.toThrow(/permission denied/);
      await expect(pg.query("delete from forecasts")).rejects.toThrow(/permission denied/);
      await expect(pg.query("select * from dishes")).rejects.toThrow(/permission denied/);
      await expect(pg.query("insert into dishes (restaurant_id, section_id, name, position) values ($1, $1, 'x', 1)", [A])).rejects.toThrow(/permission denied/);
      await expect(pg.query("select * from forecasts")).rejects.toThrow(/permission denied/);
    });
    expect(await one(pg, "select status, passed, backtest_score::float as s from model_runs where id = $1", [run])).toEqual({ status: "succeeded", passed: true, s: 0.12 });
  });

  test("analytics_reader reads the analytics views (no staff names) and no app table", async () => {
    await as("analytics_reader", null, async () => {
      const names = (await all<{ name: string }>(pg, "select name from analytics.dishes where restaurant_id in ($1, $2) order by name", [A, B])).map((r) => r.name);
      expect(names).toEqual(["A dish", "B dish"]);
      await expect(pg.query("select * from dishes")).rejects.toThrow(/permission denied/);
      await expect(pg.query("select * from staff")).rejects.toThrow(/permission denied/);
      await expect(pg.query("insert into forecasts (restaurant_id) values ($1)", [A])).rejects.toThrow(/permission denied/);
    });
    const cols = (await all<{ c: string }>(pg, "select column_name as c from information_schema.columns where table_schema = 'analytics' and table_name = 'staff'")).map((r) => r.c);
    expect(cols).not.toContain("display_name");
    // Every analytics view can be read.
    const views = (await all<{ v: string }>(pg, "select table_name as v from information_schema.views where table_schema = 'analytics'")).map((r) => r.v);
    expect(views.length).toBeGreaterThan(40);
    await as("analytics_reader", null, async () => {
      for (const v of views) await pg.query(`select * from analytics.${v} limit 1`);
    });
  });

  test("the Python service's login (queue_worker) gets both roles", async () => {
    await as("queue_worker", null, async () => {
      expect((await all(pg, "select id from analytics.restaurants where id = $1", [A])).length).toBe(1);
      await pg.query("insert into model_runs (restaurant_id, model_name, model_version, kind) values ($1, 'menu', '0.1', 'menu')", [A]);
      await expect(pg.query("select * from jobs")).rejects.toThrow(/permission denied/);
    });
  });
});

describe("staff data", () => {
  test("forgetting a person removes their details and keeps their hours, unnamed", async () => {
    const S = "abababab-0000-0000-0000-000000000001";
    await newRestaurant(pg, S, []);
    const p = await one<{ id: string }>(pg, "insert into staff (restaurant_id, display_name, skills, source) values ($1, 'Omar', '{grill}', 'manual') returning id", [S]);
    await pg.query("insert into staff_availability (restaurant_id, staff_id, weekday, starts, ends, effective_from) values ($1, $2, 5, '17:00', '23:00', '2026-01-01')", [S, p.id]);
    await pg.query("insert into staff_pay_rates (restaurant_id, staff_id, hourly_pence, effective_from) values ($1, $2, 1221, '2026-04-01')", [S, p.id]);
    const week = await one<{ id: string }>(pg, "insert into rota_weeks (restaurant_id, week_start) values ($1, '2026-10-12') returning id", [S]);
    await pg.query("insert into rota_shifts (restaurant_id, rota_week_id, staff_id, role, business_date, starts_at, ends_at) values ($1, $2, $3, 'grill', '2026-10-16', '2026-10-16T16:00Z', '2026-10-16T22:00Z')", [S, week.id, p.id]);
    expect(await one(pg, "select pay_rate_on($1, '2026-10-16') as p", [p.id])).toEqual({ p: 1221 });
    expect(await one(pg, "select forget_staff_member($1, $2) as ok", [S, p.id])).toEqual({ ok: true });
    expect(await one(pg, "select display_name, skills, deleted_at is not null as gone from staff where id = $1", [p.id])).toEqual({ display_name: "Former staff 1", skills: [], gone: true });
    expect(await one(pg, "select count(*)::int as n from staff_availability where staff_id = $1", [p.id])).toEqual({ n: 0 });
    expect(await one(pg, "select count(*)::int as n from rota_shifts where staff_id = $1", [p.id])).toEqual({ n: 1 });
    expect(await one(pg, "select count(*)::int as n from staff_pay_rates where staff_id = $1", [p.id])).toEqual({ n: 1 });
    // Another restaurant can't forget them.
    expect(await one(pg, "select forget_staff_member($1, $2) as ok", [EMBER, p.id])).toEqual({ ok: false });
  });

  test("retention: availability 3 months after leaving, hours 6 years", async () => {
    const S = "abababab-0000-0000-0000-000000000002";
    await newRestaurant(pg, S, []);
    const p = await one<{ id: string }>(pg, "insert into staff (restaurant_id, display_name, employment_end, source) values ($1, 'Left', '2026-01-31', 'manual') returning id", [S]);
    await pg.query("insert into staff_availability (restaurant_id, staff_id, weekday, starts, ends, effective_from) values ($1, $2, 1, '09:00', '17:00', '2025-01-01')", [S, p.id]);
    const counts = async (today: string, dry: boolean) =>
      Object.fromEntries((await all<{ what: string; n_rows: number }>(pg, "select what, n_rows::int from apply_staff_retention($1::date, $2)", [today, dry])).map((r) => [r.what, r.n_rows]));
    expect((await counts("2026-03-01", true)).staff_availability).toBe(0);
    expect((await counts("2026-06-01", true)).staff_availability).toBeGreaterThanOrEqual(1);
    await counts("2026-06-01", false);
    expect(await one(pg, "select count(*)::int as n from staff_availability where staff_id = $1", [p.id])).toEqual({ n: 0 });
    expect(await one(pg, "select count(*)::int as n from staff where id = $1", [p.id])).toEqual({ n: 1 });
  });
});

describe("clearing dummy data", () => {
  test("removes everything synthetic and the demo restaurants' operations data, and nothing real", async () => {
    const db = await newFullDb();
    const REAL = "cdcdcdcd-0000-0000-0000-000000000001";
    await db.query("update restaurants set is_demo = true where id in ($1, $2)", [EMBER, CARDAMOM]);
    await newRestaurant(db, REAL, [{ category: "Mains", items: [{ name: "Real dish", price: 9, description: null }] }]);
    // Real restaurant: one real and one synthetic of each kind.
    await db.query("insert into staff (restaurant_id, display_name, source) values ($1, 'Real person', 'manual'), ($1, 'Fake person', 'synthetic')", [REAL]);
    await db.query("insert into targets (restaurant_id, metric, value, effective_from, source) values ($1, 'labour_pct', 28, '2026-01-01', 'manual'), ($1, 'food_cost_pct', 30, '2026-01-01', 'synthetic')", [REAL]);
    await db.query("insert into sales_days (restaurant_id, day, net_sales, source, covers, covers_source) values ($1, '2026-10-01', 100, 'pos', 40, 'synthetic'), ($1, '2026-10-02', 100, 'pos', 41, 'manual')", [REAL]);
    // A synthetic dish on the real menu (generated test data).
    const section = await one<{ id: string }>(db, "select id from menu_sections where restaurant_id = $1", [REAL]);
    const fake = await one<{ id: string }>(db, "insert into dishes (restaurant_id, section_id, name, position, source) values ($1, $2, 'Fake dish', 2, 'synthetic') returning id", [REAL, section.id]);
    await db.query("insert into dish_prices (restaurant_id, dish_id, price_pence, effective_from, source) values ($1, $2, 500, '2026-01-01', 'synthetic')", [REAL, fake.id]);
    await db.exec(`select set_config('ops.menu_write', 'on', false); update restaurants set menu = menu_json(id) where id = '${REAL}'; select set_config('ops.menu_write', 'off', false);`);
    expect(menuItemCount((await one<{ menu: MenuCategory[] }>(db, "select menu from restaurants where id = $1", [REAL])).menu)).toBe(2);
    // Demo restaurant: operations data (all dummy), its menu and weather (kept).
    await db.query("insert into staff (restaurant_id, display_name, source) values ($1, 'Demo person', 'manual')", [EMBER]);
    await db.query("insert into weather_hours (restaurant_id, hour_start, temp) values ($1, '2026-10-01T12:00:00Z', 14)", [EMBER]);
    // Shared: a real and a synthetic calendar event, a synthetic venue.
    await db.query("insert into local_calendar (day, name, type, source) values ('2026-12-25', 'Christmas Day', 'bank_holiday', 'gov.uk'), ('2026-11-01', 'Fake fair', 'local_event', 'synthetic')");
    await db.query("insert into venues (name, kind, latitude, longitude, source) values ('Fake Arena', 'arena', 51.5, 0, 'synthetic')");
    const dishesBefore = await one<{ n: number }>(db, "select count(*)::int as n from dishes where restaurant_id = $1", [EMBER]);

    const dry = await all<{ table_name: string; n_rows: number }>(db, "select table_name, n_rows::int from clear_ops_dummy_data(true) where n_rows > 0");
    expect(dry.length).toBeGreaterThan(0);
    expect(await one(db, "select count(*)::int as n from staff")).toEqual({ n: 3 }); // a dry run deletes nothing
    await db.query("select * from clear_ops_dummy_data(false)");

    expect(await all(db, "select display_name from staff order by display_name")).toEqual([{ display_name: "Real person" }]);
    expect(await all(db, "select metric from targets")).toEqual([{ metric: "labour_pct" }]);
    expect(await all(db, "select day::text, covers from sales_days where restaurant_id = $1 order by day", [REAL])).toEqual([
      { day: "2026-10-01", covers: null },
      { day: "2026-10-02", covers: 41 },
    ]);
    expect((await one<{ menu: MenuCategory[] }>(db, "select menu from restaurants where id = $1", [REAL])).menu).toEqual([
      { category: "Mains", items: [{ name: "Real dish", price: 9, description: null }] },
    ]);
    expect(await one(db, "select count(*)::int as n from dishes where restaurant_id = $1", [EMBER])).toEqual(dishesBefore);
    expect(await one(db, "select count(*)::int as n from weather_hours where restaurant_id = $1", [EMBER])).toEqual({ n: 1 });
    expect(await all(db, "select name from local_calendar where name in ('Christmas Day', 'Fake fair')")).toEqual([{ name: "Christmas Day" }]);
    expect(await all(db, "select name from venues")).toEqual([]);
    expect((await one<{ menu: MenuCategory[] }>(db, "select menu from restaurants where id = $1", [EMBER])).menu).toEqual(before[EMBER]);
  }, 120_000);
});
