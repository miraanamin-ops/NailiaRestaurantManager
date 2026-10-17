"""The worker against a real database: a job claimed, run, written and completed; retries
with backoff then dead; the time budget; heartbeats; shutdown; two workers at once."""

from __future__ import annotations

import datetime as dt
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import psycopg
import pytest

from dinerai_analytics import queue
from dinerai_analytics.cli import main
from dinerai_analytics.config import load_config
from dinerai_analytics.cutoff import issue_time_for
from dinerai_analytics.db import connect
from dinerai_analytics.worker import Worker

from .conftest import SAFFRON, SEEDED, SEEDED_AS_OF

pytestmark = pytest.mark.integration
SERVICE = Path(__file__).resolve().parents[2]


def enqueue(env_file, job_type, restaurant=SEEDED, key=None, payload=None):
    cfg = load_config(env_file)
    with connect(cfg) as c:
        job = queue.enqueue(c, job_type, restaurant, key or f"{job_type}:{time.time_ns()}", payload or {})
    return str(job["id"])


def job_row(admin, job_id):
    return admin.execute("select status, attempts, run_at, locked_by, locked_until, started_at, last_error, result from jobs where id = %s",
                         (job_id,)).fetchone()


def runs_for(admin, job_id):
    return admin.execute("select id, role, status, passed, backtest_metric, backtest_score, metrics, data_cutoff from model_runs "
                         "where job_id = %s order by started_at", (job_id,)).fetchall()


def run_worker(env_file, **kw):
    return Worker(load_config(env_file), **kw).run(exit_when_idle=True)


def test_end_to_end_enqueue_claim_write_pass_complete(env_file, admin, capsys):
    assert main(["enqueue", "--env", env_file, "--restaurant", "test-seeded", "--model", "forecast_baseline", "--as-of", SEEDED_AS_OF]) == 0
    job_id = __import__("json").loads(capsys.readouterr().out.strip().splitlines()[-1])["job_id"]
    # The same job again (same day key) is refused.
    assert main(["enqueue", "--env", env_file, "--restaurant", "test-seeded", "--model", "forecast_baseline", "--as-of", SEEDED_AS_OF]) == 1

    outcomes = run_worker(env_file)
    assert [o.status for o in outcomes] == ["done"]
    job = job_row(admin, job_id)
    assert job[0] == "done" and job[3] is None and job[7]["rows"] == {"forecasts": 84}

    [run] = runs_for(admin, job_id)
    run_id, role, status, passed, metric, score, metrics, cutoff = run
    assert (role, status, passed, metric) == ("benchmark", "succeeded", True, "WAPE")
    assert float(score) == metrics["primary"]["wape"] and metrics["primary"]["metric"] == "orders"
    assert cutoff == issue_time_for(dt.date(2026, 3, 2))
    assert metrics["backtest"]["targets_from"] == "2025-12-08" and metrics["backtest"]["targets_to"] == "2026-03-01"
    assert metrics["backtest"]["issue_time"].startswith("05:35")

    rows = admin.execute("select metric, channel, count(*), min(target_day), max(target_day), bool_and(issued_at = %s) "
                         "from forecasts where model_run_id = %s group by 1, 2 order by 1, 2", (cutoff, run_id)).fetchall()
    assert rows == [
        ("covers", "all", 14, dt.date(2026, 3, 2), dt.date(2026, 3, 15), True),
        ("covers", "dine_in", 14, dt.date(2026, 3, 2), dt.date(2026, 3, 15), True),
        ("orders", "all", 14, dt.date(2026, 3, 2), dt.date(2026, 3, 15), True),
        ("orders", "delivery", 14, dt.date(2026, 3, 2), dt.date(2026, 3, 15), True),
        ("orders", "dine_in", 14, dt.date(2026, 3, 2), dt.date(2026, 3, 15), True),
        ("sales_pence", "all", 14, dt.date(2026, 3, 2), dt.date(2026, 3, 15), True),
    ]


def test_a_fixture_restaurant_with_three_weeks_runs_but_does_not_pass(env_file, admin):
    job_id = enqueue(env_file, "forecast_baseline", SAFFRON, payload={"as_of": "2026-03-24"})
    assert [o.status for o in run_worker(env_file)] == ["done"]
    [run] = runs_for(admin, job_id)
    assert run[2] == "succeeded" and run[3] is False  # too little history for a 12-week back-test
    channels = {r[0] for r in admin.execute("select distinct channel from forecasts where model_run_id = %s and metric = 'orders'", (run[0],))}
    assert channels == {"all", "dine_in", "takeaway", "delivery"}


def test_a_failing_model_retries_with_backoff_then_dies(env_file, admin):
    job_id = enqueue(env_file, "test_fail")
    waits = []
    for attempt in (1, 2, 3):
        before = admin.execute("select now()").fetchone()[0]
        [o] = run_worker(env_file)
        status, attempts, run_at, locked_by, *_ , last_error, _ = job_row(admin, job_id)
        assert attempts == attempt and locked_by is None and last_error == "RuntimeError: model diverged"
        if attempt < 3:
            assert o.status == "retry" and status == "queued"
            waits.append(round((run_at - before).total_seconds() / 60))
            admin.execute("update jobs set run_at = now() where id = %s", (job_id,))  # skip the wait
        else:
            assert o.status == "dead" and status == "dead"
    assert waits == [1, 5]  # the queue's backoff: 1, then 5 minutes
    runs = runs_for(admin, job_id)
    assert [r[2] for r in runs] == ["failed"] * 3
    assert runs[0][6]["error"] == "model diverged"
    assert admin.execute("select count(*) from forecasts f join model_runs m on m.id = f.model_run_id where m.job_id = %s", (job_id,)).fetchone()[0] == 0


def test_a_failure_retrying_cant_fix_dies_at_once(env_file, admin):
    job_id = enqueue(env_file, "test_permanent")
    [o] = run_worker(env_file)
    assert o.status == "dead"
    assert job_row(admin, job_id)[:2] == ("dead", 1)


def test_a_job_over_its_time_budget_is_stopped_and_retried(env_file, admin):
    job_id = enqueue(env_file, "test_timeout")
    t0 = time.monotonic()
    [o] = run_worker(env_file)
    assert time.monotonic() - t0 < 30
    assert o.status == "retry" and "time budget" in o.error
    assert job_row(admin, job_id)[0] == "queued"
    assert runs_for(admin, job_id)[0][2] == "failed"


def test_heartbeats_keep_the_lock_and_a_lost_job_is_stopped(env_file, admin):
    # A 3-second lock and a 5-second job: only heartbeats keep it.
    job_id = enqueue(env_file, "test_heartbeat", payload={"sleep": 5})
    seen = []
    worker = threading.Thread(target=lambda: seen.extend(run_worker(env_file)))
    worker.start()
    time.sleep(4)
    _, _, _, _, locked_until, started, *_ = job_row(admin, job_id)
    assert (locked_until - started).total_seconds() > 3.5  # extended past the first 3 seconds
    worker.join(30)
    assert [o.status for o in seen] == ["done"]

    # If the job is handed to someone else mid-run, the worker stops it at the next beat.
    job_id = enqueue(env_file, "test_heartbeat", payload={"sleep": 20})
    seen.clear()
    worker = threading.Thread(target=lambda: seen.extend(run_worker(env_file)))
    worker.start()
    for _ in range(50):
        if job_row(admin, job_id)[0] == "running":
            break
        time.sleep(0.1)
    admin.execute("update jobs set locked_by = 'someone-else' where id = %s", (job_id,))
    worker.join(30)
    assert [o.status for o in seen] == ["lost"]
    assert runs_for(admin, job_id)[0][2] == "failed"


def test_shutdown_gives_the_job_back_without_using_a_try(env_file, admin):
    job_id = enqueue(env_file, "test_slow", payload={"sleep": 30})
    stop = threading.Event()
    seen = []
    worker = threading.Thread(target=lambda: seen.extend(Worker(load_config(env_file), stop=stop).run()))
    worker.start()
    for _ in range(100):
        if job_row(admin, job_id)[0] == "running":
            break
        time.sleep(0.1)
    time.sleep(1)
    stop.set()
    worker.join(30)
    assert not worker.is_alive()
    assert [o.status for o in seen] == ["released"]
    status, attempts, _, locked_by, locked_until, *_ = job_row(admin, job_id)
    assert (status, attempts, locked_by, locked_until) == ("queued", 0, None, None)
    assert "shutting down" in runs_for(admin, job_id)[0][6]["error"]


def test_two_workers_never_run_the_same_job(env_file, admin):
    ids = [enqueue(env_file, "test_slow", payload={"sleep": 1}) for _ in range(12)]
    cmd = [sys.executable, "-m", "dinerai_analytics", "worker", "--env", env_file, "--exit-when-idle"]
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(SERVICE / "tests"), os.environ.get("PYTHONPATH", "")])}
    procs = [subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env) for _ in range(2)]
    outs = [p.communicate(timeout=180) for p in procs]
    assert all(p.returncode == 0 for p in procs), [o[1][-2000:] for o in outs]
    done_by = [o[0].count('"event": "job.done"') for o in outs]
    assert sum(done_by) == 12 and min(done_by) > 0, done_by  # both worked, together they did each job once
    per_job = dict(admin.execute("select job_id::text, count(*) from model_runs where job_id = any(%s::uuid[]) group by 1", (ids,)).fetchall())
    assert per_job == {i: 1 for i in ids}
    assert {job_row(admin, i)[0] for i in ids} == {"done"}


def test_the_status_command(env_file, capsys):
    job_id = enqueue(env_file, "test_slow", payload={"sleep": 0})
    assert main(["status", "--env", env_file, job_id]) == 0
    assert '"status": "queued"' in capsys.readouterr().out
    with psycopg.connect(load_config(env_file).database_url) as c:
        assert c.execute("select 1").fetchone() == (1,)
