// The synthetic datasets (analytics/generator) on the real migration chain in PGlite:
// every table loads with its constraints, the totals reconcile through the analytics
// views, and the per-restaurant clear-out removes one dataset and nothing else.
// Uses the committed 3-week fixtures; SYNTH_FULL=1 loads the full 24 months from
// analytics/generator/output (generate them first).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb } from "./support/full-pg";

const FULL = process.env.SYNTH_FULL === "1";
const ROOT = fileURLToPath(new URL(`../analytics/generator/${FULL ? "output" : "fixtures"}/`, import.meta.url));
const DATASETS = ["halal_ilford", "cafe_walthamstow", "takeaway_stratford", "halal_ilford_messy"];
const CLEAN = DATASETS.slice(0, 3);
const REAL = "abababab-1111-2222-3333-444444444444";

type Row = Record<string, unknown>;
const all = async <T = Row>(pg: PGlite, sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Row>(pg: PGlite, sql: string, params: unknown[] = []) => (await all<T>(pg, sql, params))[0];

function readDataset(key: string) {
  const dir = `${ROOT}${key}/load/`;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => ({
      table: f.slice(3, -6),
      rows: readFileSync(dir + f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Row),
    }));
}

// The same steps as load.py: venues reused by name, rows inserted in order with
// json_populate_recordset, then the menu copy made from the dishes.
async function load(pg: PGlite, key: string) {
  const tables = readDataset(key);
  const venueMap = new Map<string, string>();
  for (const { table, rows } of tables) {
    if (!rows.length) continue;
    if (table === "venues") {
      for (const v of rows) {
        const found = await one<{ id: string }>(pg, "select id from venues where ops_name_key(name) = ops_name_key($1)", [v.name]);
        if (found) venueMap.set(v.id as string, found.id);
        else {
          await insert(pg, "venues", [v]);
          venueMap.set(v.id as string, v.id as string);
        }
      }
      continue;
    }
    if (table === "local_calendar" || table === "football_fixtures") for (const r of rows) if (r.venue_id) r.venue_id = venueMap.get(r.venue_id as string) ?? r.venue_id;
    await insert(pg, table, rows);
  }
  const rid = tables.find((t) => t.table === "restaurants")!.rows[0].id as string;
  await pg.exec(`select set_config('ops.menu_write', 'on', false); update restaurants set menu = menu_json(id) where id = '${rid}'; select set_config('ops.menu_write', 'off', false);`);
  return rid;
}

async function insert(pg: PGlite, table: string, rows: Row[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
  const list = cols.map((c) => `"${c}"`).join(", ");
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    try {
      await pg.query(`insert into "${table}" (${list}) select ${list} from json_populate_recordset(null::"${table}", $1::json)`, [JSON.stringify(chunk)]);
    } catch (err) {
      throw new Error(`${table}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const present = DATASETS.every((k) => existsSync(`${ROOT}${k}/load`));
let pg: PGlite;
const ids: Record<string, string> = {};

describe.skipIf(!present)(`synthetic datasets (${FULL ? "full 24 months" : "3-week fixtures"})`, () => {
  beforeAll(async () => {
    pg = await newFullDb();
    await pg.query("insert into restaurants (id, name, is_demo) values ($1, 'A real restaurant', false)", [REAL]);
    await pg.query("insert into staff (restaurant_id, display_name, source) values ($1, 'Real person', 'manual')", [REAL]);
    for (const k of DATASETS) ids[k] = await load(pg, k);
  }, FULL ? 1_800_000 : 300_000);

  test("every dataset is a demo restaurant, inactive, and every new-table row is synthetic", async () => {
    for (const k of DATASETS) expect(await one(pg, "select is_demo, active from restaurants where id = $1", [ids[k]])).toEqual({ is_demo: true, active: false });
    const tables = (await all<{ table_name: string }>(pg,
      "select c.table_name from information_schema.columns c join information_schema.columns r on r.table_name = c.table_name and r.column_name = 'restaurant_id' and r.table_schema = 'public' where c.table_schema = 'public' and c.column_name = 'source' and c.domain_name = 'ops_source'")).map((r) => r.table_name);
    expect(tables.length).toBeGreaterThan(20);
    for (const t of tables) {
      const bad = await one<{ n: number }>(pg, `select count(*)::int as n from "${t}" where restaurant_id = any($1) and source <> 'synthetic'`, [Object.values(ids)]);
      expect(bad.n, t).toBe(0);
    }
  });

  test("item sales add up to the day; hours and channel splits add up to the day (clean datasets)", async () => {
    for (const k of CLEAN) {
      const r = ids[k];
      const items = await all(pg, `select d.day from analytics.sales_daily d
        left join (select day, sum(amount_pence_incl_vat) s from analytics.sales_items where restaurant_id = $1 group by day) i using (day)
        where d.restaurant_id = $1 and d.gross_pence is distinct from i.s`, [r]);
      expect(items, `${k} items`).toEqual([]);
      const hours = await all(pg, `select d.day from analytics.sales_daily d
        left join (select day, sum(sales_pence_incl_vat) s, sum(transactions) t, sum(covers) c from analytics.sales_hourly where restaurant_id = $1 group by day) h using (day)
        where d.restaurant_id = $1 and (d.gross_pence is distinct from h.s or d.transactions is distinct from h.t::int or d.covers is distinct from h.c::int)`, [r]);
      expect(hours, `${k} hours`).toEqual([]);
      const chans = await all(pg, `select d.day from analytics.sales_daily d
        left join (select day, sum(sales_pence) s, sum(orders) o from analytics.sales_channels where restaurant_id = $1 and hour is null group by day) c using (day)
        where d.restaurant_id = $1 and (d.gross_pence is distinct from c.s or d.transactions is distinct from c.o::int)`, [r]);
      expect(chans, `${k} channels`).toEqual([]);
      const hourly = await all(pg, `select c.day, c.hour from (select day, hour, sum(sales_pence) s from analytics.sales_channels where restaurant_id = $1 and hour is not null group by day, hour) c
        join analytics.sales_hourly h on h.restaurant_id = $1 and h.day = c.day and h.hour = c.hour where h.sales_pence_incl_vat <> c.s`, [r]);
      expect(hourly, `${k} hourly channels`).toEqual([]);
    }
  });

  test("every till item of a clean dataset links to a dish (or a known non-dish line)", async () => {
    for (const k of CLEAN) {
      expect(await one(pg, "select count(*)::int as n from analytics.sales_items where restaurant_id = $1 and dish_id is null and is_dish is distinct from false", [ids[k]]), k).toEqual({ n: 0 });
    }
    // The messy copy leaves names for the matching feature.
    expect((await one<{ n: number }>(pg, "select count(*)::int as n from analytics.sales_items where restaurant_id = $1 and dish_id is null and is_dish is null", [ids.halal_ilford_messy])).n).toBeGreaterThan(0);
  });

  test("hours worked x the pay rate on the day give the labour cost; invoices add up", async () => {
    for (const k of DATASETS) {
      const r = ids[k];
      const cost = await one<{ n: number; bad: number }>(pg, `select count(*)::int as n,
          count(*) filter (where pay_rate_on(a.staff_id, a.business_date) is null)::int as bad
          from analytics.shift_actuals a where a.restaurant_id = $1`, [r]);
      expect(cost.n, k).toBeGreaterThan(0);
      expect(cost.bad, `${k}: shifts without a pay rate`).toBe(0);
      const inv = await all(pg, `select i.id from analytics.invoices i join (select invoice_id, sum(line_net_pence) n, sum(vat_pence) v from analytics.invoice_lines group by invoice_id) l on l.invoice_id = i.id
        where i.restaurant_id = $1 and (i.net_pence <> l.n or i.vat_pence <> l.v or i.gross_pence <> i.net_pence + i.vat_pence)`, [r]);
      expect(inv, k).toEqual([]);
    }
  });

  test("the menu copy is made from the dishes, and the outside data is there", async () => {
    for (const k of DATASETS) {
      const r = ids[k];
      expect((await one<{ same: boolean }>(pg, "select menu = menu_json(id) as same from restaurants where id = $1", [r])).same, k).toBe(true);
      for (const t of ["weather_hourly", "weather_daily", "weather_forecasts", "prayer_times", "calendar", "calendar_relevance"]) {
        expect((await one<{ n: number }>(pg, `select count(*)::int as n from analytics.${t} where restaurant_id = $1`, [r])).n, `${k} ${t}`).toBeGreaterThan(0);
      }
      expect((await one<{ n: number }>(pg, "select count(*)::int as n from analytics.channel_fees where restaurant_id = $1", [r])).n).toBeGreaterThan(0);
    }
    expect((await one<{ n: number }>(pg, "select count(*)::int as n from analytics.venues")).n).toBe(2);
  });

  test("clearing one dataset leaves the others and the real restaurant alone; reloading it works", async () => {
    const before = await one<{ n: number }>(pg, "select count(*)::int as n from shift_actuals where restaurant_id = $1", [ids.cafe_walthamstow]);
    await pg.query("select * from clear_ops_dummy_data(false, $1)", [ids.halal_ilford]);
    for (const t of ["dishes", "staff", "invoices", "weather_hours", "prayer_times", "local_calendar", "channel_fees", "rota_shifts"]) {
      expect((await one<{ n: number }>(pg, `select count(*)::int as n from "${t}" where restaurant_id = $1`, [ids.halal_ilford])).n, t).toBe(0);
    }
    expect(await one(pg, "select count(*)::int as n from shift_actuals where restaurant_id = $1", [ids.cafe_walthamstow])).toEqual(before);
    expect(await all(pg, "select display_name from staff where restaurant_id = $1", [REAL])).toEqual([{ display_name: "Real person" }]);
    // A venue the other datasets still use stays; one nothing uses any more goes.
    expect(await all(pg, "select name from venues where id in (select venue_id from local_calendar) order by name")).toContainEqual({ name: "London Stadium" });
    expect((await one<{ n: number }>(pg, "select count(*)::int as n from venues where id not in (select venue_id from local_calendar where venue_id is not null)")).n).toBe(0);
    // Reload: the older tables by restaurant id, then insert again (load.py updates the restaurant row; here it is made again).
    for (const t of ["sales_items", "sales_hours", "sales_days", "campaigns", "drafts", "weather_days"]) await pg.query(`delete from "${t}" where restaurant_id = $1`, [ids.halal_ilford]);
    await pg.query("delete from restaurants where id = $1", [ids.halal_ilford]);
    await load(pg, "halal_ilford");
    expect((await one<{ n: number }>(pg, "select count(*)::int as n from dishes where restaurant_id = $1", [ids.halal_ilford])).n).toBeGreaterThan(30);
  }, 300_000);
});
