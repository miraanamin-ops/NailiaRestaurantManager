"""The command line.

  worker   --env FILE|process [--exit-when-idle] [--max-jobs N]     run the worker loop
  enqueue  --env FILE --restaurant ID|SLUG --model NAME [--as-of YYYY-MM-DD] [--again]
  run-one  --env FILE --restaurant ID|SLUG --model NAME [--as-of ...] [--dry-run]
  status   --env FILE JOB_ID [--watch]
  check    --env FILE|process                                       connection and permission smoke test
  models                                                            the registered models
  forecast-report --env FILE --restaurant ID|SLUG|demo --out FILE.json [--as-of ...] [--cutoffs 50]
           forecast_daily's back-tests and chart data (computes, writes nothing to the database)

Every command that touches a database needs --env, and --allow-production for
the production project. Add --pretty for readable logs instead of JSON lines.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import signal
import sys
import threading
import time
import uuid

import psycopg

from . import queue
from .config import Config, Refused, load_config
from .cutoff import london_day
from .db import connect, now_utc
from .logs import JobLog, log, set_pretty
from .queue import Job
from .registry import PermanentError, RegistryError, load_registry
from .runner import find_restaurant, run_job
from .worker import Worker


def _config(a) -> Config:
    return load_config(a.env, allow_production=a.allow_production)


def _restaurant(conn, ref: str) -> dict:
    r = find_restaurant(conn, ref)
    if not r:
        raise Refused(f"No restaurant {ref!r} in analytics.restaurants")
    return r


def cmd_worker(a) -> int:
    cfg = _config(a)
    stop = threading.Event()

    def on_signal(signum, _frame):
        log("worker.stopping", signal=signal.Signals(signum).name)
        stop.set()

    signal.signal(signal.SIGINT, on_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, on_signal)
    Worker(cfg, stop=stop).run(exit_when_idle=a.exit_when_idle, max_jobs=a.max_jobs)
    return 0


def _job_key(job_type: str, restaurant_id: str, as_of: str | None, again: bool) -> str:
    day = as_of or london_day(now_utc()).isoformat()
    key = f"{job_type}:{restaurant_id}:{day}:manual"
    return f"{key}:{uuid.uuid4().hex[:8]}" if again else key


def cmd_enqueue(a) -> int:
    cfg = _config(a)
    spec = load_registry(cfg.extra_models).by_name(a.model)
    with connect(cfg) as conn:
        r = _restaurant(conn, a.restaurant)
        payload = {"as_of": a.as_of} if a.as_of else {}
        key = _job_key(spec.job_type, str(r["id"]), a.as_of, a.again)
        job = queue.enqueue(conn, spec.job_type, str(r["id"]), key, payload)
    if job is None:
        print(f"Already queued (key {key}). Use --again for another job.")
        return 1
    print(json.dumps({"job_id": str(job["id"]), "type": job["type"], "restaurant": r["slug"], "key": key, "status": job["status"]}, default=str))
    return 0


def cmd_status(a) -> int:
    cfg = _config(a)
    with connect(cfg) as conn:
        while True:
            st = queue.status(conn, a.job_id)
            if st is None:
                print("No such external job (or it has been cleaned up).")
                return 1
            print(json.dumps(st, default=str))
            if not a.watch or st["status"] in ("done", "dead"):
                return 0
            time.sleep(3)


def _print_forecast(outputs: dict, metrics: dict) -> None:
    rows = outputs.get("forecasts", [])
    print(f"\n{len(rows)} forecast rows. First days of orders/all:")
    for r in [r for r in rows if (r["metric"], r["channel"]) == ("orders", "all")][:14]:
        print(f"  {r['target_day']}  low {r['low']:>9}  likely {r['likely']:>9}  high {r['high']:>9}")
    if "primary" in metrics:
        print("\nBack-test (headline):", json.dumps(metrics["primary"]))
        for s in metrics.get("series", []):
            print(f"  {s['metric']:<12} {s['channel']:<9} WAPE {s['wape']}  coverage {s['coverage']}  days {s['days']}")


def cmd_run_one(a) -> int:
    """One job in the foreground, in this process (so a debugger works). --dry-run writes nothing."""
    cfg = _config(a)
    registry = load_registry(cfg.extra_models)
    spec = registry.by_name(a.model)
    jl = JobLog(command="run-one")
    with connect(cfg) as conn:
        r = _restaurant(conn, a.restaurant)
        rid = str(r["id"])
        payload = {"as_of": a.as_of} if a.as_of else {}
        if a.dry_run:
            job = Job(id="dry-run", type=spec.job_type, restaurant_id=rid, key="dry-run", payload=payload, attempts=0, max_attempts=1, lock_seconds=300)
            out = run_job(cfg, job, str(uuid.uuid4()), registry=registry, conn=conn, dry_run=True, log=jl)
            _print_forecast(out["outputs"], out["metrics"])
            return 0

        worker_id = f"run-one-{uuid.uuid4().hex[:6]}"
        job = queue.claim(conn, worker_id, [spec.job_type], rid)
        if job is None:
            queue.enqueue(conn, spec.job_type, rid, _job_key(spec.job_type, rid, a.as_of, again=True), payload)
            job = queue.claim(conn, worker_id, [spec.job_type], rid)
        if job is None:
            print("Couldn't claim a job (the type may be at its max_running limit). Try again in a minute.")
            return 1
        jl.info("run_one.claimed", job_id=job.id, key=job.key)

        # Heartbeats on their own connection while the model runs here.
        done = threading.Event()

        def heartbeat():
            with connect(cfg) as hb:
                while not done.wait(max(1.0, min(60, job.lock_seconds / 3))):
                    queue.extend(hb, job.id, worker_id, job.lock_seconds)

        t = threading.Thread(target=heartbeat, daemon=True)
        t.start()
        try:
            summary = run_job(cfg, job, str(uuid.uuid4()), registry=registry, conn=conn, log=jl)
        except Exception as e:
            done.set()
            after = queue.fail(conn, job.id, worker_id, f"{type(e).__name__}: {e}", retry=not isinstance(e, PermanentError))
            print(f"Failed: {e}\nJob is now: {json.dumps(after, default=str)}")
            return 1
        done.set()
        queue.complete(conn, job.id, worker_id, summary)
        print(json.dumps({"job_id": job.id, **summary}, default=str))
        return 0


def cmd_check(a) -> int:
    """Connects, then proves the login can do what it should and nothing more."""
    cfg = _config(a)
    results = []

    def probe(name: str, query: str, should_work: bool):
        with connect(cfg) as c:
            try:
                c.execute(query).fetchall()
                ok = should_work
            except psycopg.errors.InsufficientPrivilege:
                ok = not should_work
            results.append((name, ok))

    with connect(cfg) as c:
        user = c.execute("select current_user as u").fetchone()["u"]
    probe("reads analytics.restaurants", "select id from analytics.restaurants limit 1", True)
    probe("can't read the app's restaurants table", "select id from public.restaurants limit 1", False)
    probe("can't read the jobs table", "select id from public.jobs limit 1", False)
    probe("can't change forecasts", "update public.forecasts set likely = likely where false", False)
    for name, ok in results:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    print(f"Connected to {cfg.target} as {user} ({cfg.env}); models: {', '.join(load_registry(cfg.extra_models).job_types)}")
    return 0 if all(ok for _, ok in results) and user == "queue_worker" else 1


def cmd_forecast_report(a) -> int:
    """forecast_daily's full report (for the private charts page): the nightly run computed in full (nothing is
    written), the long back-test across the history, and the chart data, as one JSON file."""
    from pathlib import Path

    from .models.forecast_daily import model as fmodel
    from .models.forecast_daily import report as freport
    from .runner import make_context

    cfg = _config(a)
    spec = load_registry(cfg.extra_models).by_name("forecast_daily")
    out = {}
    with connect(cfg) as conn:
        if a.restaurant == "demo":
            refs = [str(r["restaurant_id"]) for r in conn.execute(
                "select distinct d.restaurant_id from analytics.sales_daily d join analytics.restaurants r on r.id = d.restaurant_id "
                "where r.is_demo order by 1").fetchall()]
        else:
            refs = [a.restaurant]
        for ref in refs:
            r = _restaurant(conn, ref)
            payload = {"as_of": a.as_of} if a.as_of else {}
            job = Job(id="report", type=spec.job_type, restaurant_id=str(r["id"]), key="report", payload=payload, attempts=0, max_attempts=1, lock_seconds=300)
            ctx = make_context(conn, spec, job)
            n = fmodel.nightly(ctx)
            entry = {"restaurant": {"id": str(r["id"]), "slug": r["slug"], "name": r["name"]}, "passed": n.result.passed, "metrics": n.result.metrics}
            if n.replay is not None:
                # The nightly run made the 50-cut-off long back-test unless one was cached; reuse it when it matches.
                same = n.long is not None and len(n.long["cutoffs"]) == a.cutoffs
                entry["long_backtest"] = n.long if same else freport.long_backtest(n.prep, ctx.trading_day_cutoff_hour, ctx.restaurant_id, n.profiles,
                                                                                   a.cutoffs)
                entry["charts"] = freport.chart_data(n.prep, n)
                entry["weights_now"] = freport.weights_now(n.prep, n.live)
            out[r["slug"]] = entry
            log("forecast_report.restaurant", slug=r["slug"], passed=n.result.passed, wape=n.result.score)
    Path(a.out).write_text(json.dumps(out, default=str), encoding="utf8")
    print(f"Wrote {a.out} ({len(out)} restaurant(s))")
    return 0


def cmd_models(a) -> int:
    for s in load_registry().specs:
        print(f"{s.name} {s.version}  role={s.role}  kind={s.kind}  job_type={s.job_type}  views={','.join(s.views)}  budget={s.time_budget_s}s")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="dinerai-analytics", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def with_env(sp):
        sp.add_argument("--env", required=True, help="an env file (outside OneDrive), or 'process' for the environment")
        sp.add_argument("--allow-production", action="store_true")
        sp.add_argument("--pretty", action="store_true", help="readable logs instead of JSON lines")
        return sp

    w = with_env(sub.add_parser("worker"))
    w.add_argument("--exit-when-idle", action="store_true", help="stop once the queue has nothing for it")
    w.add_argument("--max-jobs", type=int)
    w.set_defaults(fn=cmd_worker)

    e = with_env(sub.add_parser("enqueue"))
    e.add_argument("--restaurant", required=True)
    e.add_argument("--model", required=True)
    e.add_argument("--as-of", type=lambda s: dt.date.fromisoformat(s).isoformat())
    e.add_argument("--again", action="store_true", help="queue another job even if one with today's key exists")
    e.set_defaults(fn=cmd_enqueue)

    r = with_env(sub.add_parser("run-one"))
    r.add_argument("--restaurant", required=True)
    r.add_argument("--model", required=True)
    r.add_argument("--as-of", type=lambda s: dt.date.fromisoformat(s).isoformat())
    r.add_argument("--dry-run", action="store_true", help="compute and print, write nothing, don't touch the queue")
    r.set_defaults(fn=cmd_run_one)

    s = with_env(sub.add_parser("status"))
    s.add_argument("job_id")
    s.add_argument("--watch", action="store_true")
    s.set_defaults(fn=cmd_status)

    c = with_env(sub.add_parser("check"))
    c.set_defaults(fn=cmd_check)

    fr = with_env(sub.add_parser("forecast-report"))
    fr.add_argument("--restaurant", required=True, help="an id or slug, or 'demo' for every demo restaurant with sales")
    fr.add_argument("--as-of", type=lambda s: dt.date.fromisoformat(s).isoformat())
    fr.add_argument("--cutoffs", type=int, default=50, help="cut-offs in the long back-test")
    fr.add_argument("--out", required=True, help="the JSON file to write")
    fr.set_defaults(fn=cmd_forecast_report)

    m = sub.add_parser("models")
    m.add_argument("--pretty", action="store_true")
    m.set_defaults(fn=cmd_models)
    return p


def main(argv: list[str] | None = None) -> int:
    a = parser().parse_args(argv)
    set_pretty(getattr(a, "pretty", False))
    try:
        return a.fn(a)
    except (Refused, RegistryError) as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2
