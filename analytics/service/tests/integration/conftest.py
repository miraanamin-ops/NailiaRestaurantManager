"""A throwaway local Postgres (pgserver) built like a fresh Supabase project: Supabase's
stand-in roles (the same ones the app's tests use), setup.sql and every migration
(the generator's apply_migrations.py), the 3-week fixtures (load.py --fixture), and
queue_worker given a login. Plus one restaurant with 21 weeks of plain, made-up
sales, so the 12-week back-test has enough history to pass.

Skipped when pgserver isn't installed (pip install -r requirements-dev.txt)."""

from __future__ import annotations

import datetime as dt
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

pgserver = pytest.importorskip("pgserver")
import psycopg  # noqa: E402

REPO = Path(__file__).resolve().parents[4]
GENERATOR = REPO / "analytics" / "generator"
if str(GENERATOR) not in sys.path:
    sys.path.append(str(GENERATOR))

import apply_migrations  # noqa: E402
import load  # noqa: E402

SEEDED = "77777777-7777-7777-7777-777777777777"  # 21 weeks of made-up sales ending 2026-02-28
SAFFRON = "33333333-3333-3333-3333-333333333333"  # the fixture's halal_ilford (2 to 22 March 2026)
SEEDED_AS_OF = "2026-03-02"
TEST_JOB_TYPES = [  # (type, max_running, max_attempts, lock_seconds)
    ("test_fail", 4, 3, 300),
    ("test_permanent", 4, 3, 300),
    ("test_slow", 10, 3, 300),
    ("test_timeout", 4, 2, 300),
    ("test_heartbeat", 4, 3, 3),
]


def _standins() -> str:
    ts = (REPO / "tests" / "support" / "full-pg.ts").read_text(encoding="utf8")
    return re.search(r"SUPABASE_STANDINS = `(.*?)`;", ts, re.S).group(1)


def _as_user(uri: str, user: str, password: str) -> str:
    u = urlsplit(uri)
    host = u.hostname or ""
    netloc = f"{user}:{password}@{host}" + (f":{u.port}" if u.port else "")
    return urlunsplit((u.scheme, netloc, u.path, u.query, u.fragment))


def seed_sales(cur, restaurant_id: str, end: dt.date, days: int) -> None:
    """Orders follow the weekday with a small wobble; delivery is a steady 12 a day."""
    for i in range(days):
        d = end - dt.timedelta(days=i)
        orders = 50 + 6 * d.weekday() + (i * 7) % 5
        cur.execute(
            "insert into sales_days (restaurant_id, day, net_sales, transactions, covers, covers_source, source, is_dummy) "
            "values (%s, %s, %s, %s, %s, 'synthetic', 'seed', true)",
            (restaurant_id, d, orders * 22.5, orders, orders + 15),
        )
        for channel, n, covers in (("dine_in", orders - 12, orders + 15), ("delivery", 12, None)):
            cur.execute(
                "insert into sales_channel_splits (restaurant_id, day, hour, channel, sales_pence, orders, covers, source) "
                "values (%s, %s, null, %s, %s, %s, %s, 'synthetic')",
                (restaurant_id, d, channel, n * 2700, n, covers),
            )


@pytest.fixture(scope="session")
def database(tmp_path_factory):
    """(superuser URI, queue_worker URI)."""
    import tzdata

    tz = Path(pgserver.__file__).parent / "pginstall" / "share" / "postgresql" / "timezone"
    if not (tz / "Europe" / "London").exists():
        shutil.copytree(Path(tzdata.__file__).parent / "zoneinfo", tz, dirs_exist_ok=True)
    srv = pgserver.get_server(tmp_path_factory.mktemp("pg"), cleanup_mode="stop")
    uri = srv.get_uri()
    with psycopg.connect(uri, autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(_standins())
        strip = lambda f, sql: re.sub(r"create extension if not exists (pg_cron|pg_net);", "", sql, flags=re.I)  # noqa: E731
        apply_migrations.apply_all(cur, resume=False, transform=strip)
        apply_migrations.remove_schedules(cur)
    env = tmp_path_factory.mktemp("env") / "synth.env"
    env.write_text(f"DATABASE_URL={uri}\nTEST_TOOLS=true\n", encoding="utf8")
    assert load.main(["--env", str(env), "--fixture"]) == 0
    with psycopg.connect(uri, autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("alter role queue_worker with login password 'worker-pw'")
        for t, running, attempts, lock in TEST_JOB_TYPES:
            cur.execute("insert into job_types (type, runner, max_running, max_attempts, lock_seconds) values (%s, 'external', %s, %s, %s) "
                        "on conflict (type) do nothing", (t, running, attempts, lock))
        cur.execute("insert into restaurants (id, name, slug, is_demo, active) values (%s, 'Seeded Grill', 'test-seeded', true, false)", (SEEDED,))
        seed_sales(cur, SEEDED, dt.date(2026, 2, 28), 21 * 7)
    return uri, _as_user(uri, "queue_worker", "worker-pw")


@pytest.fixture()
def env_file(database, tmp_path):
    """An analytics env file for queue_worker, with the test models loaded."""
    _, worker_uri = database
    f = tmp_path / "analytics-test.env"
    settings = [f"DATABASE_URL={worker_uri}", "ANALYTICS_ENV=dev", "POLL_SECONDS=0.2", "SHUTDOWN_GRACE_SECONDS=0.5", "EXTRA_MODELS=dinerai_test_models"]
    f.write_text("\n".join(settings) + "\n", encoding="utf8")
    return str(f)


@pytest.fixture()
def admin(database):
    """A superuser connection, for setting up and checking (never what the service uses)."""
    uri, _ = database
    with psycopg.connect(uri, autocommit=True) as conn:
        yield conn


@pytest.fixture(autouse=True)
def empty_queue(database):
    uri, _ = database
    with psycopg.connect(uri, autocommit=True) as conn:
        conn.execute("delete from jobs")
    yield
