"""Running one model job, the same way for every model.

1. Find the restaurant's trading-day cut-off, the issue time (now, or 03:05 UK
   on the job's as_of day) and the last trading day known by then (cutoff.py).
2. Create the model_runs row (status running, the model's role, the data window).
3. Run the model.
4. In one transaction: write its outputs tied to the run, and finish the run as
   succeeded with metrics, score and passed. So a succeeded run always has its
   outputs, and a failed one has none.
5. On any error: finish the run as failed (with the error in metrics), then raise.
"""

from __future__ import annotations

import datetime as dt
import json
import time
from typing import Any

import psycopg
from psycopg import sql

from .config import Config
from .cutoff import issue_time_for, known_through, london_day
from .db import ViewReader, connect, finish_run, insert_rows, now_utc
from .logs import JobLog
from .queue import Job
from .registry import MODEL_OUTPUTS, ModelResult, ModelSpec, PermanentError, Registry, RunContext, load_registry


def find_restaurant(conn: psycopg.Connection, ref: str) -> dict | None:
    """A restaurant by id or slug, from analytics.restaurants."""
    column = "id" if len(ref) == 36 and ref.count("-") == 4 else "slug"
    query = sql.SQL("select id, slug, name, is_demo, active, trading_day_cutoff from analytics.restaurants where {} = %s").format(sql.Identifier(column))
    with conn.cursor() as cur:
        cur.execute(query, (ref,))
        return cur.fetchone()


def issue_time_from(payload: dict) -> dt.datetime:
    """03:05 UK on payload['as_of'] (a replay, or a dev run on old data), else now."""
    as_of = payload.get("as_of")
    if not as_of:
        return now_utc()
    try:
        return issue_time_for(dt.date.fromisoformat(str(as_of)))
    except ValueError as e:
        raise PermanentError(f"as_of {as_of!r} isn't a date (YYYY-MM-DD)") from e


def make_context(conn: psycopg.Connection, spec: ModelSpec, job: Job) -> RunContext:
    if not job.restaurant_id:
        raise PermanentError("The job has no restaurant")
    restaurant = find_restaurant(conn, job.restaurant_id)
    if not restaurant:
        raise PermanentError(f"Restaurant {job.restaurant_id} isn't in analytics.restaurants")
    cutoff_hour = restaurant["trading_day_cutoff"].hour if restaurant.get("trading_day_cutoff") else 5
    issue_time = issue_time_from(job.payload)
    return RunContext(
        restaurant_id=job.restaurant_id,
        reader=ViewReader(conn, job.restaurant_id, spec.views),
        payload=job.payload,
        issue_time=issue_time,
        issue_day=london_day(issue_time),
        known_through=known_through(issue_time, cutoff_hour),
        trading_day_cutoff_hour=cutoff_hour,
    )


def _check_result(spec: ModelSpec, result: Any) -> ModelResult:
    if not isinstance(result, ModelResult):
        raise TypeError(f"{spec.name} returned {type(result).__name__}, not a ModelResult")
    unknown = set(result.outputs) - set(MODEL_OUTPUTS)
    if unknown:
        raise ValueError(f"{spec.name} returned rows for {', '.join(sorted(unknown))}, which aren't model output tables")
    json.dumps(result.metrics, default=str)  # must be storable
    return result


def run_job(cfg: Config, job: Job, run_id: str, registry: Registry | None = None, conn: psycopg.Connection | None = None,
            dry_run: bool = False, log: JobLog | None = None) -> dict:
    """Runs the job's model. Returns a summary (and, for a dry run, the outputs and metrics). Raises on failure,
    PermanentError when retrying can't help."""
    registry = registry or load_registry(cfg.extra_models)
    spec = registry.for_job_type(job.type)
    own_conn = conn is None
    conn = conn or connect(cfg)
    log = (log or JobLog()).bind(job_id=job.id, restaurant_id=job.restaurant_id, model=spec.name, version=spec.version,
                                 role=spec.role, run_id=None if dry_run else run_id, attempt=job.attempts)
    started = time.monotonic()
    created = False
    try:
        ctx = make_context(conn, spec, job)
        if not dry_run:
            insert_rows(conn, "model_runs", [{
                "id": run_id,
                "restaurant_id": job.restaurant_id,
                "model_name": spec.name,
                "model_version": spec.version,
                "kind": spec.kind,
                "role": spec.role,
                "status": "running",
                "data_from": ctx.known_through - dt.timedelta(days=spec.history_days),
                "data_to": ctx.known_through,
                "data_cutoff": ctx.issue_time,
                "backtest_metric": spec.backtest_metric,
                "params": {**spec.params, "issue_day": ctx.issue_day.isoformat(), "payload": job.payload},
                "job_id": job.id,
                "source": "model",
            }])
            created = True
        log.info("run.started", issue_day=ctx.issue_day, known_through=ctx.known_through)

        t0 = time.monotonic()
        result = _check_result(spec, spec.run(ctx))
        model_ms = int((time.monotonic() - t0) * 1000)
        counts = {t: len(rows) for t, rows in result.outputs.items()}
        summary = {"run_id": None if dry_run else run_id, "model": spec.name, "version": spec.version, "role": spec.role,
                   "rows": counts, "score": result.score, "passed": result.passed, "model_ms": model_ms}
        if dry_run:
            log.info("run.dry_run", rows=counts, score=result.score, passed=result.passed, model_ms=model_ms)
            return {**summary, "outputs": result.outputs, "metrics": result.metrics}

        t1 = time.monotonic()
        with conn.transaction():
            for table, rows in result.outputs.items():
                insert_rows(conn, table, [{**r, "restaurant_id": job.restaurant_id, "model_run_id": run_id, "issued_at": ctx.issue_time} for r in rows])
            if not finish_run(conn, run_id, "succeeded", result.metrics, result.score, result.passed):
                raise RuntimeError("The run was no longer running (stopped by the worker?); its outputs were not written")
        write_ms = int((time.monotonic() - t1) * 1000)
        summary.update(write_ms=write_ms, total_ms=int((time.monotonic() - started) * 1000))
        log.info("run.finished", status="succeeded", rows=counts, score=result.score, passed=result.passed,
                 model_ms=model_ms, write_ms=write_ms, total_ms=summary["total_ms"])
        return summary
    except Exception as e:
        if created:
            try:
                finish_run(conn, run_id, "failed", {"error": str(e)[:1000], "error_type": type(e).__name__})
            except Exception as finish_err:  # the job failure below still reaches the queue
                log.error("run.finish_failed", error=str(finish_err)[:500])
        log.error("run.failed", error=str(e)[:1000], error_type=type(e).__name__, permanent=isinstance(e, PermanentError),
                  total_ms=int((time.monotonic() - started) * 1000))
        raise
    finally:
        if own_conn:
            conn.close()
