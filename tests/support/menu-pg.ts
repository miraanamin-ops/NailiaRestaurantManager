// The menu's database functions (save_menu, menu_json; supabase/031_ops_menu.sql)
// for the in-memory Supabase stand-in (memory-db.ts): the restaurant's menu rows
// are copied into PGlite, the real SQL function runs, and the rows come back.
// So app code that saves a menu in a test runs exactly the live logic.
import { PGlite } from "@electric-sql/pglite";
import { readMigration, SUPABASE_STANDINS } from "./full-pg";

type Row = Record<string, unknown>;

export const MENU_FUNCTIONS = ["save_menu", "menu_json"];
export const MENU_TABLES = ["menu_sections", "dishes", "dish_prices", "dish_renames"]; // parents first

// What 030 and 031 need from the rest of the database.
const BEFORE = `
  create table restaurants (id uuid primary key, name text not null default '', menu jsonb not null default '[]'::jsonb,
    owner_email text, is_demo boolean not null default false, created_at timestamptz not null default now());
  create table schema_migrations (name text primary key);
  create table sales_items (id uuid primary key default gen_random_uuid(), restaurant_id uuid, item text);
`;

let shared: Promise<PGlite> | null = null;
export function sharedMenuDb() {
  shared ??= (async () => {
    const pg = await PGlite.create();
    await pg.exec(SUPABASE_STANDINS);
    await pg.exec(BEFORE);
    await pg.exec(readMigration("030_ops_foundation.sql"));
    await pg.exec(readMigration("031_ops_menu.sql"));
    return pg;
  })();
  return shared;
}

// Runs a menu function against the stand-in's tables (changed in place).
export async function menuRpc(tables: Record<string, Row[]>, fn: string, args: Record<string, unknown>) {
  const pg = await sharedMenuDb();
  const rid = String(args.p_restaurant_id);
  const restaurant = (tables.restaurants ?? []).find((r) => r.id === rid);
  if (!restaurant) return { data: null, error: { message: `save_menu: no restaurant ${rid}` } };
  try {
    return await pg.transaction(async (tx) => {
      for (const t of [...MENU_TABLES].reverse()) await tx.query(`delete from ${t} where restaurant_id = $1`, [rid]);
      await tx.query("delete from restaurants where id = $1", [rid]);
      await tx.query("insert into restaurants (id, name, menu) values ($1, $2, $3)", [rid, String(restaurant.name ?? ""), JSON.stringify(restaurant.menu ?? [])]);
      for (const t of MENU_TABLES) {
        const rows = (tables[t] ?? []).filter((r) => r.restaurant_id === rid);
        if (rows.length) await tx.query(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(rows)]);
      }
      const call =
        fn === "save_menu"
          ? await tx.query<{ out: unknown }>("select save_menu($1, $2::jsonb, $3, $4::jsonb) as out", [
              rid,
              JSON.stringify(args.p_menu ?? []),
              String(args.p_source ?? "manual"),
              JSON.stringify(args.p_renames ?? []),
            ])
          : await tx.query<{ out: unknown }>("select menu_json($1, $2) as out", [rid, Boolean(args.p_with_ids)]);
      for (const t of MENU_TABLES) {
        const back = await tx.query<{ row: Row }>(`select to_jsonb(x) as row from ${t} x where restaurant_id = $1`, [rid]);
        tables[t] = [...(tables[t] ?? []).filter((r) => r.restaurant_id !== rid), ...back.rows.map((r) => r.row)];
      }
      const menu = await tx.query<{ menu: unknown }>("select menu from restaurants where id = $1", [rid]);
      restaurant.menu = menu.rows[0].menu;
      return { data: call.rows[0].out, error: null };
    });
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }
}
