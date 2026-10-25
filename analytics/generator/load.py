"""Load synthetic datasets into a Supabase database as demo restaurants.

  py load.py --env C:\\Users\\<you>\\dev\\synth.env --dataset all [--dry-run]
  py load.py --env ... --dataset cafe_walthamstow --fixture   (the 3-week slice)
  py load.py --env ... --dataset cafe_walthamstow --clear     (remove a dataset, load nothing)

Rules:
- --env is required: credentials are read from that file only (DATABASE_URL, and
  TEST_TOOLS=true to allow loading). Files inside OneDrive are refused.
- The production (live) project is always refused: demo data stays on dev.
- Each dataset's restaurant must be a demo restaurant (or not exist yet; it is then
  created as a demo, inactive). A real restaurant is never touched.
- Re-running replaces a dataset: its old rows are cleared first (the older tables by
  restaurant id, then clear_ops_dummy_data(false, restaurant)), all in one transaction.
- --dry-run does the whole load inside a transaction and rolls it back.
- The database size is reported before and after.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import psycopg
from psycopg.types.json import Json

from synth.datasets import DATASETS
from synth.dbsafety import Refused, describe_target, is_production, read_env, test_tools_on
from synth.rows import TABLE_ORDER

HERE = Path(__file__).resolve().parent
BATCH = 2000
# The older tables, cleared by restaurant id (children first), as scripts/clear-dummy-data.mjs does.
OLD_TABLES = ["sales_items", "sales_hours", "sales_days", "z_reports", "pos_imports", "campaign_sends", "campaigns", "drafts", "weather_days"]
RESTAURANT_FIELDS = ["name", "slug", "cuisine", "address", "opening_hours", "latitude", "longitude", "council_name", "council_code",
                     "nation", "prayer_method", "is_demo", "active", "trading_day_cutoff"]


def read_rows(folder: Path) -> dict[str, list[dict]]:
    out = {}
    for i, t in enumerate(TABLE_ORDER):
        f = folder / f"{i:02d}_{t}.jsonl"
        out[t] = [json.loads(line) for line in f.read_text(encoding="utf8").splitlines() if line.strip()] if f.exists() else []
    return out


def size(cur) -> str:
    cur.execute("select pg_size_pretty(pg_database_size(current_database())), pg_database_size(current_database())")
    return cur.fetchone()


def insert(cur, table: str, rows: list[dict]):
    if not rows:
        return
    cols = sorted({k for r in rows for k in r})
    col_sql = ", ".join(f'"{c}"' for c in cols)
    for i in range(0, len(rows), BATCH):
        chunk = [{c: r.get(c) for c in cols} for r in rows[i:i + BATCH]]
        cur.execute(f'insert into "{table}" ({col_sql}) select {col_sql} from json_populate_recordset(null::"{table}", %s::json)',
                    (json.dumps(chunk),))


def clear_one(cur, key: str) -> None:
    """Removes a dataset's rows (the restaurant row itself stays, as a demo with nothing in it)."""
    rid = DATASETS[key]["id"]
    cur.execute("select is_demo from restaurants where id = %s", (rid,))
    row = cur.fetchone()
    if row is None:
        print("   not loaded here, nothing to clear")
        return
    if not row[0]:
        raise Refused(f"{key}: restaurant {rid} is NOT a demo restaurant. Nothing was cleared.")
    for t in OLD_TABLES:
        cur.execute(f'delete from "{t}" where restaurant_id = %s', (rid,))
    cur.execute("select table_name, n_rows from clear_ops_dummy_data(false, %s) where n_rows > 0", (rid,))
    print("   cleared: " + (", ".join(f"{t} {n}" for t, n in cur.fetchall()) or "nothing"))


def load_one(cur, key: str, T: dict[str, list[dict]]) -> dict[str, int]:
    r = T["restaurants"][0]
    rid = r["id"]
    cur.execute("select is_demo from restaurants where id = %s", (rid,))
    row = cur.fetchone()
    if row is not None and not row[0]:
        raise Refused(f"{key}: restaurant {rid} exists and is NOT a demo restaurant. Nothing was loaded.")
    cur.execute("select id from restaurants where slug = %s and id <> %s", (r["slug"], rid))
    if cur.fetchone():
        raise Refused(f"{key}: another restaurant already uses the slug {r['slug']}. Nothing was loaded.")
    # 1. Clear the dataset's old rows.
    if row is not None:
        for t in OLD_TABLES:
            cur.execute(f'delete from "{t}" where restaurant_id = %s', (rid,))
        cur.execute("select table_name, n_rows from clear_ops_dummy_data(false, %s) where n_rows > 0", (rid,))
        cleared = cur.fetchall()
        if cleared:
            print("   cleared: " + ", ".join(f"{t} {n}" for t, n in cleared))
    # 2. The restaurant: created as a demo (inactive), or its details refreshed.
    vals = [Json(r[f]) if f == "opening_hours" else r[f] for f in RESTAURANT_FIELDS]
    cur.execute(
        f"insert into restaurants (id, {', '.join(RESTAURANT_FIELDS)}) values (%s, {', '.join(['%s'] * len(RESTAURANT_FIELDS))}) "
        f"on conflict (id) do update set {', '.join(f'{f} = excluded.{f}' for f in RESTAURANT_FIELDS)} where restaurants.is_demo",
        [rid, *vals])
    # 3. Shared venues: reuse one with the same name if it is already there (venue names are unique).
    venue_map = {}
    for v in T["venues"]:
        cur.execute("select id from venues where ops_name_key(name) = ops_name_key(%s)", (v["name"],))
        found = cur.fetchone()
        if found:
            venue_map[v["id"]] = str(found[0])
        else:
            insert(cur, "venues", [v])
            venue_map[v["id"]] = v["id"]
    for t in ("local_calendar", "football_fixtures"):
        for x in T[t]:
            if x.get("venue_id"):
                x["venue_id"] = venue_map.get(x["venue_id"], x["venue_id"])
    counts = {}
    for t in TABLE_ORDER:
        if t in ("restaurants", "venues"):
            continue
        t0 = time.time()
        insert(cur, t, T[t])
        counts[t] = len(T[t])
        if len(T[t]) > 20000:
            print(f"   {t}: {len(T[t]):,} rows ({time.time() - t0:.0f}s)")
    # 4. The menu copy in restaurants.menu, made from the dishes just loaded (as clear_ops_dummy_data does).
    cur.execute("select set_config('ops.menu_write', 'on', true)")
    cur.execute("update restaurants set menu = menu_json(id) where id = %s", (rid,))
    cur.execute("select set_config('ops.menu_write', 'off', true)")
    return counts


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", required=True, help="path to the env file with DATABASE_URL (no default)")
    ap.add_argument("--dataset", default="all")
    ap.add_argument("--fixture", action="store_true", help="load the 3-week fixtures/ slice instead of output/")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--clear", action="store_true", help="remove the dataset(s) and load nothing")
    a = ap.parse_args(argv)
    try:
        env = read_env(a.env)
        if is_production(env):
            raise Refused("That is the PRODUCTION (live) Supabase project. Demo data only goes into the dev project. Nothing was changed.")
        if not test_tools_on(env):
            raise Refused("TEST_TOOLS is not on in that env file. Add TEST_TOOLS=true to allow loading demo data there.")
        keys = list(DATASETS) if a.dataset == "all" else [a.dataset]
        root = HERE / ("fixtures" if a.fixture else "output")
        for k in keys:
            if not a.clear and not (root / k / "load").exists():
                raise Refused(f"No {root / k / 'load'}: run generate.py first.")
        print(f"Target: {describe_target(env)}  ({'dry run, nothing kept' if a.dry_run else 'clearing' if a.clear else 'loading'})")
        with psycopg.connect(env["DATABASE_URL"], autocommit=False, prepare_threshold=None) as conn:
            cur = conn.cursor()
            cur.execute("set statement_timeout = 0")
            cur.execute("select exists (select 1 from schema_migrations where name = '038_ops_data_gaps.sql')")
            if not cur.fetchone()[0]:
                raise Refused("This database doesn't have migration 038 yet. Run apply_migrations.py (dev) or paste 038 first.")
            before = size(cur)
            print(f"Database size before: {before[0]}")
            conn.commit()
            for k in keys:
                t0 = time.time()
                print(f"{k}:")
                if a.clear:
                    try:
                        clear_one(cur, k)
                    except Exception:
                        conn.rollback()
                        raise
                    conn.rollback() if a.dry_run else conn.commit()
                    continue
                T = read_rows(root / k / "load")
                try:
                    counts = load_one(cur, k, T)
                except Exception:
                    conn.rollback()
                    raise
                if a.dry_run:
                    conn.rollback()
                else:
                    conn.commit()
                print(f"   {sum(counts.values()):,} rows {'checked (rolled back)' if a.dry_run else 'loaded'} in {time.time() - t0:.0f}s")
            after = size(cur)
            conn.commit()
            print(f"Database size after: {after[0]} (was {before[0]}, change {(after[1] - before[1]) / 1e6:+.1f} MB)")
        return 0
    except Refused as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
