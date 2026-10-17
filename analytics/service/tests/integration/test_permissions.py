"""What the queue_worker login can and can't do, on the real migration chain."""

from __future__ import annotations

import uuid
from decimal import Decimal

import psycopg
import pytest
from psycopg.errors import InsufficientPrivilege, RaiseException

from dinerai_analytics.cli import main

from .conftest import SEEDED

pytestmark = pytest.mark.integration


@pytest.fixture()
def worker(database):
    _, worker_uri = database
    with psycopg.connect(worker_uri, autocommit=True) as conn:
        yield conn


def denied(conn, query, params=()):
    with pytest.raises(InsufficientPrivilege):
        conn.execute(query, params)


def new_run(conn, run_id=None, role="benchmark"):
    run_id = run_id or str(uuid.uuid4())
    conn.execute("insert into model_runs (id, restaurant_id, model_name, model_version, kind, role, data_to, params) "
                 "values (%s, %s, 'perm_test', '1.0.0', 'forecast', %s, '2026-02-28', '{\"a\": 1}')", (run_id, SEEDED, role))
    return run_id


@pytest.mark.parametrize("table", ["restaurants", "customers", "sales_days", "staff", "jobs", "job_types", "messages"])
def test_it_cannot_read_app_tables(worker, table):
    denied(worker, f"select * from public.{table} limit 1")


def test_it_reads_the_analytics_views_and_cannot_change_them(worker):
    assert worker.execute("select count(*) from analytics.sales_daily where restaurant_id = %s", (SEEDED,)).fetchone()[0] == 147
    denied(worker, "delete from analytics.sales_daily")


def test_it_cannot_change_app_tables(worker):
    denied(worker, "insert into restaurants (name) values ('x')")
    denied(worker, "update sales_days set net_sales = 0")


def test_it_adds_outputs_but_cannot_read_update_or_delete_them(worker, admin):
    run_id = new_run(worker)
    worker.execute("insert into forecasts (restaurant_id, model_run_id, target_day, metric, low, likely, high) "
                   "values (%s, %s, '2026-03-02', 'orders', 1, 2, 3)", (SEEDED, run_id))
    denied(worker, "select * from forecasts")
    denied(worker, "update forecasts set likely = 99 where model_run_id = %s", (run_id,))
    denied(worker, "delete from forecasts where model_run_id = %s", (run_id,))
    denied(worker, "delete from model_runs where id = %s", (run_id,))
    assert admin.execute("select likely from forecasts where model_run_id = %s", (run_id,)).fetchone()[0] == 2


def test_it_can_only_finish_a_run_and_only_the_allowed_columns_change(worker, admin):
    run_id = new_run(worker)
    for col, value in [("status", "succeeded"), ("passed", True), ("role", "production"), ("model_name", "x"), ("data_to", "2030-01-01")]:
        denied(worker, f"update model_runs set {col} = %s where id = %s", (value, run_id))
    cols = "model_name, model_version, kind, role, data_from, data_to, data_cutoff, backtest_metric, params, job_id, restaurant_id, started_at, source"
    before = admin.execute(f"select {cols} from model_runs where id = %s", (run_id,)).fetchone()
    assert worker.execute("select finish_model_run(%s, 'succeeded', '{\"wape\": 0.2}', 0.2, true)", (run_id,)).fetchone()[0] is True
    after = admin.execute(f"select {cols} from model_runs where id = %s", (run_id,)).fetchone()
    assert after == before
    assert admin.execute("select status, passed, backtest_score, metrics, finished_at is not null from model_runs where id = %s", (run_id,)).fetchone() == (
        "succeeded", True, Decimal("0.2000"), {"wape": 0.2}, True)
    # Once finished it can't be changed again.
    assert worker.execute("select finish_model_run(%s, 'failed')", (run_id,)).fetchone()[0] is False


def test_it_cannot_claim_or_add_app_jobs(worker, admin):
    admin.execute("select * from enqueue_job('weather', %s, 'perm-weather')", (SEEDED,))
    with pytest.raises(RaiseException, match="Only external job types"):
        worker.execute("select * from ext_claim_jobs('py', array['weather'], 1)")
    with pytest.raises(RaiseException, match="Only external job types"):
        worker.execute("select * from ext_claim_jobs('py', array['forecast_baseline', 'morning'], 1, %s)", (SEEDED,))
    with pytest.raises(RaiseException, match="not an external job type"):
        worker.execute("select * from ext_enqueue_job('owner_message', %s, 'x')", (SEEDED,))
    denied(worker, "select * from claim_jobs('py')")
    denied(worker, "select * from enqueue_job('weather', null, 'x')")
    assert admin.execute("select status from jobs where idempotency_key = 'perm-weather'").fetchone()[0] == "queued"


def test_the_check_command_passes(env_file, capsys):
    assert main(["check", "--env", env_file]) == 0
    assert capsys.readouterr().out.count("ok  ") == 4
