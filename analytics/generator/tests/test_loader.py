"""The loader's safety rules, and a real load into a local Postgres built with the full
migration chain (skipped when pgserver isn't installed: pip install pgserver)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import apply_migrations
import load
from synth.datasets import DATASETS
from synth.dbsafety import PRODUCTION_REF, Refused, is_production, read_env
from synth.dbsafety import test_tools_on as tools_on

REPO = Path(__file__).resolve().parents[3]


def env_file(tmp_path, **kw) -> str:
    p = tmp_path / "synth.env"
    p.write_text("\n".join(f"{k}={v}" for k, v in kw.items()) + "\n", encoding="utf8")
    return str(p)


def test_production_is_recognised():
    assert is_production({"DATABASE_URL": f"postgresql://postgres.{PRODUCTION_REF}:x@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"})
    assert is_production({"DATABASE_URL": "postgresql://x", "SUPABASE_URL": f"https://{PRODUCTION_REF}.supabase.co"})
    assert not is_production({"DATABASE_URL": "postgresql://postgres.abcdefgh:x@pooler.supabase.com/postgres"})


def test_env_files_in_onedrive_are_refused(tmp_path):
    d = tmp_path / "OneDrive" / "repo"
    d.mkdir(parents=True)
    (d / ".env.local").write_text("DATABASE_URL=postgresql://x\n")
    with pytest.raises(Refused, match="OneDrive"):
        read_env(str(d / ".env.local"))


def test_test_tools_switch_matches_the_app():
    assert tools_on({"TEST_TOOLS": "true"}) and tools_on({"TEST_TOOLS": " ON "})
    assert not tools_on({}) and not tools_on({"TEST_TOOLS": "false", "TEST_MODE": "true"})
    assert tools_on({"TEST_MODE": "true"})            # the deprecated fallback
    assert not tools_on({"TEST_TOOLS": "maybe", "TEST_MODE": "true"})  # unreadable = safe value


def test_load_refuses_production_and_full_data_there(tmp_path, capsys):
    prod = env_file(tmp_path, DATABASE_URL=f"postgresql://postgres.{PRODUCTION_REF}:pw@host:5432/postgres", TEST_TOOLS="true")
    assert load.main(["--env", prod]) == 2
    assert "PRODUCTION" in capsys.readouterr().err
    assert load.main(["--env", prod, "--allow-production"]) == 2
    assert "Only the 3-week fixture" in capsys.readouterr().err
    assert apply_migrations.main(["--env", prod]) == 2


def test_load_needs_test_tools(tmp_path, capsys):
    dev = env_file(tmp_path, DATABASE_URL="postgresql://postgres:pw@localhost:1/postgres")
    assert load.main(["--env", dev, "--fixture"]) == 2
    assert "TEST_TOOLS" in capsys.readouterr().err


def test_env_is_required():
    with pytest.raises(SystemExit):
        load.main([])


# --- a real database ------------------------------------------------------------
pgserver = pytest.importorskip("pgserver")


def _standins() -> str:
    """Supabase's own roles and schemas, exactly as the app's tests stand them in (tests/support/full-pg.ts)."""
    ts = (REPO / "tests" / "support" / "full-pg.ts").read_text(encoding="utf8")
    return re.search(r"SUPABASE_STANDINS = `(.*?)`;", ts, re.S).group(1)


@pytest.fixture(scope="module")
def database(tmp_path_factory):
    import shutil

    import psycopg
    import tzdata
    # Some pgserver builds ship without time-zone files; Python's tzdata has the same (TZif) files Postgres reads.
    tz = Path(pgserver.__file__).parent / "pginstall" / "share" / "postgresql" / "timezone"
    if not (tz / "Europe" / "London").exists():
        shutil.copytree(Path(tzdata.__file__).parent / "zoneinfo", tz, dirs_exist_ok=True)
    srv = pgserver.get_server(tmp_path_factory.mktemp("pg"), cleanup_mode="stop")
    uri = srv.get_uri()
    with psycopg.connect(uri, autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(_standins())
        strip = lambda f, sql: re.sub(r"create extension if not exists (pg_cron|pg_net);", "", sql, flags=re.I)
        apply_migrations.apply_all(cur, resume=False, transform=strip)
        assert apply_migrations.remove_schedules(cur)  # the migrations scheduled jobs; a dev project must not keep them
        cur.execute("insert into restaurants (id, name, is_demo) values ('abababab-0000-0000-0000-00000000000a', 'Real', false)")
        cur.execute("insert into staff (restaurant_id, display_name, source) values ('abababab-0000-0000-0000-00000000000a', 'Real person', 'manual')")
    yield uri


def _count(uri, sql, *args):
    import psycopg
    with psycopg.connect(uri) as c:
        return c.execute(sql, args).fetchone()[0]


def test_fixtures_load_reload_and_dry_run(database, tmp_path, capsys):
    env = env_file(tmp_path, DATABASE_URL=database, TEST_TOOLS="true")
    assert load.main(["--env", env, "--fixture"]) == 0
    out = capsys.readouterr().out
    assert "Database size before" in out and "Database size after" in out
    ids = [d["id"] for d in DATASETS.values()]
    n = _count(database, "select count(*) from sales_days where restaurant_id = any(%s)", ids)
    assert n > 60
    staff = _count(database, "select count(*) from staff where restaurant_id = any(%s)", ids)
    # Loading again replaces the data: same counts, nothing doubled.
    assert load.main(["--env", env, "--fixture"]) == 0
    assert _count(database, "select count(*) from sales_days where restaurant_id = any(%s)", ids) == n
    assert _count(database, "select count(*) from staff where restaurant_id = any(%s)", ids) == staff
    assert _count(database, "select count(*) from venues") == 2
    # A dry run changes nothing.
    assert load.main(["--env", env, "--fixture", "--dry-run"]) == 0
    assert _count(database, "select count(*) from staff where restaurant_id = any(%s)", ids) == staff
    # The real restaurant was never touched; menus are made from the dishes.
    assert _count(database, "select count(*) from staff where restaurant_id = 'abababab-0000-0000-0000-00000000000a'") == 1
    assert _count(database, "select count(*) from restaurants where id = any(%s) and menu = menu_json(id) and is_demo and not active", ids) == 4
    # Clearing one dataset removes it and nothing else.
    cafe = DATASETS["cafe_walthamstow"]["id"]
    others = _count(database, "select count(*) from staff where restaurant_id = any(%s) and restaurant_id <> %s", ids, cafe)
    assert load.main(["--env", env, "--dataset", "cafe_walthamstow", "--clear"]) == 0
    for t in ("staff", "sales_days", "dishes", "weather_hours", "campaigns"):
        assert _count(database, f"select count(*) from {t} where restaurant_id = %s", cafe) == 0, t
    assert _count(database, "select count(*) from staff where restaurant_id = any(%s) and restaurant_id <> %s", ids, cafe) == others
    assert load.main(["--env", env, "--fixture", "--dataset", "cafe_walthamstow"]) == 0


def test_a_real_restaurant_with_a_dataset_id_is_refused(database, tmp_path, capsys):
    import psycopg
    rid = DATASETS["cafe_walthamstow"]["id"]
    with psycopg.connect(database, autocommit=True) as c:
        c.execute("update restaurants set is_demo = false where id = %s", (rid,))
        before = c.execute("select count(*) from staff where restaurant_id = %s", (rid,)).fetchone()[0]
    env = env_file(tmp_path, DATABASE_URL=database, TEST_TOOLS="true")
    assert load.main(["--env", env, "--fixture", "--dataset", "cafe_walthamstow"]) == 2
    assert "NOT a demo restaurant" in capsys.readouterr().err
    assert _count(database, "select count(*) from staff where restaurant_id = %s", rid) == before
    with psycopg.connect(database, autocommit=True) as c:
        c.execute("update restaurants set is_demo = true where id = %s", (rid,))
