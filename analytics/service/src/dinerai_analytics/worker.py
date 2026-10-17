"""The worker: takes this service's jobs from the queue and runs them, one at a time.

- Claims only the job types its models are registered for (ext_claim_jobs).
- Each job runs in its own process, so a job over its time budget can really be
  stopped, and heavy libraries' memory is freed after every job.
- While the job runs, the worker sends heartbeats (ext_extend_job). If the
  database says the job isn't ours any more (its lock ran out and it was handed
  on), the worker stops it at once, so a job never runs twice.
- Done: ext_complete_job. Failed: the run is finished as failed and ext_fail_job
  records the error; the queue retries after its backoff, or marks the job dead
  (the app's hourly health check then alerts the builder). Errors retrying can't
  fix skip the retries.
- Stopping (SIGTERM, Ctrl+C): no new jobs; the running one gets
  SHUTDOWN_GRACE_SECONDS to finish, then is stopped and given back
  (ext_release_job), without using up a try. Nothing stays locked.
- Any number of copies can run at once: the database hands each job to one.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import random
import socket
import threading
import time
import traceback
import uuid
from dataclasses import dataclass

import psycopg

from . import queue
from .config import Config
from .db import connect, finish_run
from .logs import JobLog, log
from .queue import Job
from .registry import PermanentError, Registry, load_registry

HEARTBEAT_MAX_S = 60


def new_worker_id() -> str:
    host = os.environ.get("RAILWAY_REPLICA_ID") or socket.gethostname()
    return f"py-{host[:24]}-{uuid.uuid4().hex[:6]}"


def _child(cfg_dict: dict, job_dict: dict, run_id: str, send) -> None:
    """A job's own process: run the model and report back through the pipe."""
    from .runner import run_job

    cfg, job = Config.from_dict(cfg_dict), Job.from_dict(job_dict)
    try:
        summary = run_job(cfg, job, run_id)
        send.send({"ok": True, "summary": summary})
    except PermanentError as e:
        send.send({"ok": False, "retry": False, "error": str(e)})
    except BaseException as e:  # noqa: BLE001 - every failure must reach the queue
        send.send({"ok": False, "retry": True, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})
    finally:
        send.close()


@dataclass
class Outcome:
    job_id: str
    status: str  # done | retry | dead | released | lost
    run_id: str | None = None
    error: str | None = None


class Worker:
    def __init__(self, cfg: Config, registry: Registry | None = None, worker_id: str | None = None,
                 stop: threading.Event | None = None, restaurant_id: str | None = None):
        self.cfg = cfg
        self.registry = registry or load_registry(cfg.extra_models)
        self.worker_id = worker_id or new_worker_id()
        self.stop = stop or threading.Event()
        self.restaurant_id = restaurant_id
        self.types = self.registry.job_types
        self.log = JobLog(worker=self.worker_id)
        self._conn: psycopg.Connection | None = None

    # --- database, reconnecting after a dropped connection ---
    def conn(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            self._conn = connect(self.cfg)
        return self._conn

    def _db(self, fn, *args, **kwargs):
        for attempt in range(3):
            try:
                return fn(self.conn(), *args, **kwargs)
            except psycopg.OperationalError as e:
                self.log.warning("db.reconnect", error=str(e)[:300], attempt=attempt + 1)
                try:
                    if self._conn is not None:
                        self._conn.close()
                except Exception:  # noqa: BLE001
                    pass
                self._conn = None
                time.sleep(min(2 ** attempt, 10))
        return fn(self.conn(), *args, **kwargs)

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()

    # --- the loop ---
    def run(self, exit_when_idle: bool = False, max_jobs: int | None = None) -> list[Outcome]:
        outcomes: list[Outcome] = []
        self.log.info("worker.started", env=self.cfg.env, target=self.cfg.target, job_types=self.types)
        try:
            while not self.stop.is_set() and (max_jobs is None or len(outcomes) < max_jobs):
                try:
                    job = self._db(queue.claim, self.worker_id, self.types, self.restaurant_id)
                except Exception as e:  # noqa: BLE001 - keep the worker alive; the queue is the source of truth
                    self.log.error("worker.claim_failed", error=str(e)[:500])
                    self.stop.wait(self.cfg.poll_seconds)
                    continue
                if job is None:
                    if exit_when_idle:
                        break
                    self.stop.wait(self.cfg.poll_seconds * random.uniform(0.8, 1.2))
                    continue
                outcomes.append(self.handle(job))
        finally:
            self.log.info("worker.stopped", jobs=len(outcomes))
            self.close()
        return outcomes

    def handle(self, job: Job) -> Outcome:
        jl = self.log.bind(job_id=job.id, restaurant_id=job.restaurant_id, job_type=job.type, attempt=job.attempts)
        try:
            spec = self.registry.for_job_type(job.type)
        except PermanentError as e:
            return self._failed(job, None, str(e), retry=False, jl=jl)
        run_id = str(uuid.uuid4())
        jl = jl.bind(model=spec.name, version=spec.version, run_id=run_id)
        jl.info("job.claimed", time_budget_s=spec.time_budget_s, lock_s=job.lock_seconds)

        ctx = mp.get_context("spawn")
        recv, send = ctx.Pipe(duplex=False)
        proc = ctx.Process(target=_child, args=(self.cfg.to_dict(), job.to_dict(), run_id, send), daemon=True)
        started = time.monotonic()
        proc.start()
        send.close()
        deadline = started + spec.time_budget_s
        beat = max(1.0, min(HEARTBEAT_MAX_S, job.lock_seconds / 3))
        next_beat = started + beat
        stop_seen: float | None = None
        msg = None
        try:
            while True:
                if recv.poll(0.2):
                    try:
                        msg = recv.recv()
                    except EOFError:
                        msg = None
                    break
                if not proc.is_alive():
                    msg = recv.recv() if recv.poll(0.5) else None
                    break
                now = time.monotonic()
                if now >= deadline:
                    self._kill(proc)
                    return self._failed(job, run_id, f"Over its time budget ({spec.time_budget_s}s); stopped", retry=True, jl=jl, started=started)
                if self.stop.is_set():
                    stop_seen = stop_seen or now
                    if now - stop_seen >= self.cfg.shutdown_grace_seconds:
                        self._kill(proc)
                        return self._released(job, run_id, jl, started)
                if now >= next_beat:
                    if not self._extend(job, jl):
                        self._kill(proc)
                        self._finish_failed(run_id, "The job was handed to another worker (its lock ran out)", jl)
                        jl.error("job.lost", total_ms=int((time.monotonic() - started) * 1000))
                        return Outcome(job.id, "lost", run_id, "lock lost")
                    next_beat = now + beat
        finally:
            recv.close()
            proc.join(5)
            if proc.is_alive():
                self._kill(proc)

        if msg is None:
            return self._failed(job, run_id, f"The job's process stopped without reporting (exit code {proc.exitcode})", retry=True, jl=jl, started=started)
        if msg["ok"]:
            summary = msg["summary"]
            done = self._db(queue.complete, job.id, self.worker_id, summary)
            total_ms = int((time.monotonic() - started) * 1000)
            if not done:
                jl.error("job.complete_refused", total_ms=total_ms)
                return Outcome(job.id, "lost", run_id, "complete refused")
            jl.info("job.done", rows=summary.get("rows"), score=summary.get("score"), passed=summary.get("passed"), total_ms=total_ms)
            return Outcome(job.id, "done", run_id)
        if msg.get("trace"):
            jl.error("job.trace", trace=msg["trace"])
        return self._failed(job, run_id, msg["error"], retry=msg["retry"], jl=jl, started=started)

    # --- helpers ---
    def _extend(self, job: Job, jl: JobLog) -> bool:
        try:
            return bool(self._db(queue.extend, job.id, self.worker_id, job.lock_seconds))
        except Exception as e:  # noqa: BLE001 - one missed beat isn't fatal; the lock still has time left
            jl.warning("job.heartbeat_failed", error=str(e)[:300])
            return True

    def _finish_failed(self, run_id: str | None, error: str, jl: JobLog) -> None:
        if not run_id:
            return
        try:
            self._db(finish_run, run_id, "failed", {"error": error[:1000]})
        except Exception as e:  # noqa: BLE001
            jl.error("run.finish_failed", error=str(e)[:300])

    def _failed(self, job: Job, run_id: str | None, error: str, retry: bool, jl: JobLog, started: float | None = None) -> Outcome:
        self._finish_failed(run_id, error, jl)
        total_ms = int((time.monotonic() - started) * 1000) if started else None
        try:
            after = self._db(queue.fail, job.id, self.worker_id, error, retry)
        except Exception as e:  # noqa: BLE001 - the lock will run out and the queue takes it back
            jl.error("job.fail_unrecorded", error=str(e)[:300], job_error=error[:500])
            return Outcome(job.id, "lost", run_id, error)
        if after is None:
            jl.error("job.fail_refused", job_error=error[:500])
            return Outcome(job.id, "lost", run_id, error)
        status = "dead" if after["status"] == "dead" else "retry"
        jl.error("job.failed", status=status, error=error[:1000], retry_at=after["run_at"] if status == "retry" else None,
                 attempts=after["attempts"], max_attempts=after["max_attempts"], total_ms=total_ms)
        return Outcome(job.id, status, run_id, error)

    def _released(self, job: Job, run_id: str, jl: JobLog, started: float) -> Outcome:
        self._finish_failed(run_id, "Stopped: the worker was shutting down (the job was given back)", jl)
        try:
            ok = self._db(queue.release, job.id, self.worker_id)
        except Exception as e:  # noqa: BLE001
            jl.error("job.release_failed", error=str(e)[:300])
            ok = False
        jl.warning("job.released", given_back=ok, total_ms=int((time.monotonic() - started) * 1000))
        return Outcome(job.id, "released", run_id)

    @staticmethod
    def _kill(proc) -> None:
        if proc.is_alive():
            proc.terminate()
            proc.join(5)
        if proc.is_alive():
            proc.kill()
            proc.join(5)


def log_startup_problem(error: Exception) -> None:
    log("worker.refused", "error", error=str(error))
