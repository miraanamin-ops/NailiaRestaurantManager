"""The job queue, through the ext_* functions (supabase/027_job_queue.sql, 039).

queue_worker can't read or change the jobs table; these functions only work for
job types whose runner is 'external', and only the worker holding a job can
finish, fail, extend or release it. Retries and backoff (1, 5, 15, then 60
minutes) and marking a job dead happen in the database (fail_job).
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from typing import Any

import psycopg


@dataclass(frozen=True)
class Job:
    id: str
    type: str
    restaurant_id: str | None
    key: str
    payload: dict
    attempts: int
    max_attempts: int
    lock_seconds: int  # how long the claim holds before it counts as crashed

    @classmethod
    def from_row(cls, r: dict) -> Job:
        started: dt.datetime = r["started_at"]
        locked: dt.datetime = r["locked_until"]
        lock = int(round((locked - started).total_seconds())) if started and locked else 300
        return cls(
            id=str(r["id"]),
            type=r["type"],
            restaurant_id=str(r["restaurant_id"]) if r["restaurant_id"] else None,
            key=r["idempotency_key"],
            payload=r["payload"] or {},
            attempts=r["attempts"],
            max_attempts=r["max_attempts"],
            lock_seconds=max(lock, 1),
        )

    def to_dict(self) -> dict:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: dict) -> Job:
        return cls(**d)


def _one(conn: psycopg.Connection, query: str, params: tuple) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchone()


def claim(conn: psycopg.Connection, worker: str, types: list[str], restaurant_id: str | None = None) -> Job | None:
    if restaurant_id:
        row = _one(conn, "select * from ext_claim_jobs(%s, %s, 1, %s)", (worker, types, restaurant_id))
    else:
        row = _one(conn, "select * from ext_claim_jobs(%s, %s, 1)", (worker, types))
    return Job.from_row(row) if row else None


def complete(conn: psycopg.Connection, job_id: str, worker: str, result: dict | None = None) -> bool:
    row = _one(conn, "select ext_complete_job(%s, %s, %s::jsonb) as ok", (job_id, worker, json.dumps(result) if result is not None else None))
    return bool(row and row["ok"])


def fail(conn: psycopg.Connection, job_id: str, worker: str, error: str, retry: bool = True) -> dict | None:
    """Returns the job as it is now: status 'queued' (will retry at run_at) or 'dead'; None if it wasn't ours."""
    return _one(conn, "select id, status, attempts, max_attempts, run_at from ext_fail_job(%s, %s, %s, %s)", (job_id, worker, error[:2000], retry))


def extend(conn: psycopg.Connection, job_id: str, worker: str, seconds: int) -> bool:
    row = _one(conn, "select ext_extend_job(%s, %s, %s) as ok", (job_id, worker, int(seconds)))
    return bool(row and row["ok"])


def release(conn: psycopg.Connection, job_id: str, worker: str) -> bool:
    """Give a job back without using up a try (shutting down)."""
    row = _one(conn, "select ext_release_job(%s, %s) as ok", (job_id, worker))
    return bool(row and row["ok"])


def enqueue(conn: psycopg.Connection, job_type: str, restaurant_id: str, key: str, payload: dict | None = None,
            run_at: dt.datetime | None = None, priority: int = 50) -> dict | None:
    """Returns the new job, or None if a job with this key already exists."""
    return _one(conn, "select id, type, restaurant_id, idempotency_key, status, run_at from ext_enqueue_job(%s, %s, %s, %s::jsonb, %s, %s)",
                (job_type, restaurant_id, key, json.dumps(payload or {}), run_at, priority))


def status(conn: psycopg.Connection, job_id: str) -> dict[str, Any] | None:
    return _one(conn, "select * from ext_job_status(%s)", (job_id,))
