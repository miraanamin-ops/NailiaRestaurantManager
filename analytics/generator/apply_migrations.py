"""Build a fresh dev Supabase project's database: setup.sql then every numbered file in
supabase/, in the order the app's tests use (tests/support/full-pg.ts).

  py apply_migrations.py --env C:\\Users\\<you>\\dev\\synth.env           a brand-new project
  py apply_migrations.py --env ... --resume                                 only files not yet recorded

- Never runs against the production project (whatever flags are given).
- Refuses a database that already has the app's tables, unless --resume.
- Afterwards removes the scheduled jobs the migrations create (pg_cron), so the dev
  project never calls the live app's cron endpoint.
- Then marks the database as the dev project (its description), which the dev-only
  SQL seeds in supabase/seed/ require.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import psycopg
from psycopg import sql as pgsql

from synth.dbsafety import Refused, describe_target, is_production, read_env

SUPABASE = Path(__file__).resolve().parents[2] / "supabase"


def migration_files() -> list[str]:
    numbered = sorted(f.name for f in SUPABASE.iterdir() if re.match(r"^\d{3}[a-z]?_.*\.sql$", f.name))
    return ["setup.sql", *numbered]


def apply_all(cur, resume: bool, transform=None) -> list[str]:
    """Run every file this database hasn't recorded yet. `transform` (tests only) may rewrite a file's SQL."""
    cur.execute("select to_regclass('public.restaurants') is not null")
    exists = cur.fetchone()[0]
    done: set[str] = set()
    if exists:
        if not resume:
            raise Refused("This database already has the app's tables. Use --resume to run only the files it hasn't recorded.")
        cur.execute("select name from schema_migrations")
        done = {r[0] for r in cur.fetchall()}
    ran = []
    for f in migration_files():
        if f in done or (f == "setup.sql" and exists):
            continue
        sql = (SUPABASE / f).read_text(encoding="utf-8-sig")
        if transform:
            sql = transform(f, sql)
        print(f"  running {f}")
        try:
            cur.execute(sql)
        except Exception as e:
            raise Refused(f"{f} failed: {e}")
        ran.append(f)
    return ran


def remove_schedules(cur) -> list[str]:
    cur.execute("select to_regclass('cron.job') is not null")
    if not cur.fetchone()[0]:
        return []
    cur.execute("select jobname from cron.job")
    jobs = [r[0] for r in cur.fetchall()]
    for j in jobs:
        cur.execute("select cron.unschedule(%s)", (j,))
    return jobs


# The dev project's mark: dev-only SQL seeds (supabase/seed/) refuse any database
# without it, so they can never run on the live one.
DEV_MARK = "dinerai-dev: the DinerAI dev project (demo data allowed)"


def mark_dev(cur) -> None:
    cur.execute("select current_database()")
    name = cur.fetchone()[0]
    # COMMENT takes no bind parameters, so the name and text are quoted by psycopg.
    cur.execute(pgsql.SQL("comment on database {} is {}").format(pgsql.Identifier(name), pgsql.Literal(DEV_MARK)))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", required=True)
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args(argv)
    try:
        env = read_env(a.env)
        if is_production(env):
            raise Refused("That is the PRODUCTION project. This script only builds a fresh dev project.")
        print(f"Target: {describe_target(env)}")
        with psycopg.connect(env["DATABASE_URL"], autocommit=True, prepare_threshold=None) as conn:
            cur = conn.cursor()
            apply_all(cur, a.resume)
            jobs = remove_schedules(cur)
            if jobs:
                print(f"  removed scheduled jobs (the dev project must not call the live app): {', '.join(jobs)}")
            mark_dev(cur)
            print("  marked as the dev project (dev-only seeds may run here)")
            cur.execute("select count(*) from schema_migrations")
            print(f"Done: {cur.fetchone()[0]} migrations recorded.")
        return 0
    except Refused as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
