"""forecast_daily and forecast_refresh against a real database (the full migration chain, 040 included):
the queue_worker login's rights on the new tables, a nightly run end to end, too little history, and the
07:00 refresh."""

from __future__ import annotations

import json
import uuid

import psycopg
import pytest
from psycopg.errors import InsufficientPrivilege

from dinerai_analytics.cli import main

from .conftest import SAFFRON, SEEDED, SEEDED_AS_OF

pytestmark = pytest.mark.integration


@pytest.fixture()
def worker(database):
    _, worker_uri = database
    with psycopg.connect(worker_uri, autocommit=True) as conn:
        yield conn


def denied(conn, query, params=()):
    with pytest.raises(InsufficientPrivilege):
        conn.execute(query, params)


def new_run(conn, role="production"):
    run_id = str(uuid.uuid4())
    conn.execute("insert into model_runs (id, restaurant_id, model_name, model_version, kind, role, data_to, params) "
                 "values (%s, %s, 'perm_test', '1.0.0', 'forecast', %s, '2026-02-28', '{}')", (run_id, SEEDED, role))
    return run_id


def test_the_job_types_are_external_with_their_limits(admin):
    rows = admin.execute("select type, runner, max_running, max_attempts, lock_seconds from job_types "
                         "where type in ('forecast_daily', 'forecast_refresh') order by type").fetchall()
    assert rows == [("forecast_daily", "external", 4, 3, 300), ("forecast_refresh", "external", 4, 3, 180)]


@pytest.mark.parametrize("table", ["model_coefficients", "forecast_drivers"])
def test_it_adds_coefficients_and_drivers_but_cannot_read_change_or_delete_them(worker, admin, table):
    run_id = new_run(worker)
    if table == "model_coefficients":
        worker.execute("insert into model_coefficients (restaurant_id, model_run_id, channel, factor, estimate, sd, prior_mean, prior_sd) "
                       "values (%s, %s, 'all', 'bank_holiday', 0.1, 0.05, 0.095, 0.2)", (SEEDED, run_id))
    else:
        worker.execute("insert into forecast_drivers (restaurant_id, model_run_id, target_day, channel, factor, multiplier) "
                       "values (%s, %s, '2026-03-02', 'all', 'weekday', 1.2)", (SEEDED, run_id))
    denied(worker, f"select * from public.{table}")
    denied(worker, f"update public.{table} set factor = 'x' where model_run_id = %s", (run_id,))
    denied(worker, f"delete from public.{table} where model_run_id = %s", (run_id,))
    assert admin.execute(f"select count(*) from {table} where model_run_id = %s", (run_id,)).fetchone()[0] == 1
    # Read back only through the analytics view (for the 07:00 refresh).
    assert worker.execute(f"select count(*) from analytics.{table} where model_run_id = %s", (run_id,)).fetchone()[0] == 1
    # A row must belong to a run of the same restaurant.
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        worker.execute("insert into forecast_drivers (restaurant_id, model_run_id, target_day, channel, factor, multiplier) "
                       "values (%s, %s, '2026-03-02', 'all', 'weekday', 1.2)", (SAFFRON, run_id))


def test_the_calendar_view_has_the_alternative_dates(worker):
    rows = worker.execute("select name, first_day, alt_day from analytics.calendar where restaurant_id = %s and date_uncertain order by first_day",
                          (SAFFRON,)).fetchall()
    assert rows and all(r[2] is not None and r[2] > r[1] for r in rows)


def run_one(env_file, capsys, restaurant, model, as_of):
    assert main(["run-one", "--env", env_file, "--restaurant", restaurant, "--model", model, "--as-of", as_of]) == 0
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_a_nightly_run_writes_forecasts_weights_and_drivers_tied_to_a_production_run(env_file, admin, capsys):
    out = run_one(env_file, capsys, "test-seeded", "forecast_daily", SEEDED_AS_OF)
    assert out["model"] == "forecast_daily" and out["role"] == "production"
    assert out["rows"]["forecasts"] > 0 and out["rows"]["model_coefficients"] > 0 and out["rows"]["forecast_drivers"] > 0
    run = admin.execute("select role, status, passed, backtest_metric, metrics from model_runs where id = %s", (out["run_id"],)).fetchone()
    assert run[:2] == ("production", "succeeded") and run[3] == "WAPE" and run[2] is not None
    m = run[4]
    assert m["pass"]["passed"] == run[2] and set(m["benchmarks"]) == {"last_week", "baseline", "ets"}
    assert "no opening hours are set: every day counts as open all day (no hours-open offset)" in m["notes"]
    # 56 days of daily orders; every row ordered low <= likely <= high; channels add up to all.
    days = admin.execute("select target_day, channel, likely from forecasts where model_run_id = %s and metric = 'orders' and hour_start is null",
                         (out["run_id"],)).fetchall()
    assert len({d for d, _, _ in days}) == 56
    by_day = {}
    for d, ch, v in days:
        by_day.setdefault(d, {})[ch] = float(v)
    assert all(abs(v["all"] - sum(x for c, x in v.items() if c != "all")) < 0.011 for v in by_day.values())
    disordered = admin.execute("select count(*) from forecasts where model_run_id = %s and not (low <= likely and likely <= high)", (out["run_id"],))
    assert disordered.fetchone()[0] == 0
    # No hourly history: no hourly rows.
    assert admin.execute("select count(*) from forecasts where model_run_id = %s and hour_start is not null", (out["run_id"],)).fetchone()[0] == 0
    coefs = admin.execute("select distinct channel from model_coefficients where model_run_id = %s", (out["run_id"],)).fetchall()
    assert sorted(c for (c,) in coefs) == ["delivery", "dine_in"]

    # The 07:00 refresh: days 0 to 2 again from that run's weights, its passed copied, the run recorded.
    ref = run_one(env_file, capsys, "test-seeded", "forecast_refresh", SEEDED_AS_OF)
    r = admin.execute("select role, status, passed, metrics from model_runs where id = %s", (ref["run_id"],)).fetchone()
    assert r[:2] == ("production", "succeeded") and r[2] == run[2] and r[3]["base_run_id"] == out["run_id"]
    assert len(admin.execute("select distinct target_day from forecasts where model_run_id = %s", (ref["run_id"],)).fetchall()) == 3


def test_too_little_history_gives_no_forecast_and_fails_quietly(env_file, admin, capsys):
    # The fixture restaurant has 3 weeks of sales: a success (no alert), no rows, not passed.
    out = run_one(env_file, capsys, "demo-saffron-lane", "forecast_daily", "2026-03-23")
    assert out["rows"] == {} and out["passed"] is False
    m = admin.execute("select status, passed, metrics from model_runs where id = %s", (out["run_id"],)).fetchone()
    assert m[0] == "succeeded" and m[1] is False and "skipped" in m[2]


def test_the_refresh_writes_nothing_without_a_run_that_day(env_file, capsys):
    out = run_one(env_file, capsys, "test-seeded", "forecast_refresh", "2026-03-10")
    assert out["rows"] == {} and out["passed"] is False
