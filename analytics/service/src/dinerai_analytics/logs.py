"""Structured logs: one JSON line per event on stdout (Railway shows and searches them).

Each line has the time, level and event, plus whatever the job adds: job_id,
restaurant_id, model, version, run_id, attempt, timings (ms) and row counts.
PRETTY=1 (or --pretty on the command line) prints readable lines instead.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
from typing import Any

_pretty = os.environ.get("PRETTY") == "1"


def set_pretty(on: bool) -> None:
    global _pretty
    _pretty = on
    if on:
        os.environ["PRETTY"] = "1"  # a job's own process reads it at start-up


def _default(v: Any) -> str:
    return v.isoformat() if isinstance(v, (dt.date, dt.datetime)) else str(v)


def log(event: str, level: str = "info", **fields: Any) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    if _pretty:
        extras = " ".join(f"{k}={_default(v) if not isinstance(v, (int, float, str)) else v}" for k, v in fields.items() if v is not None)
        print(f"{now:%H:%M:%S} {level.upper():5} {event} {extras}", file=sys.stdout, flush=True)
        return
    line = {"ts": now.isoformat(timespec="milliseconds"), "level": level, "event": event}
    line.update({k: v for k, v in fields.items() if v is not None})
    print(json.dumps(line, default=_default), file=sys.stdout, flush=True)


class JobLog:
    """A logger that adds the job's fields to every line."""

    def __init__(self, **fields: Any):
        self.fields = fields

    def bind(self, **more: Any) -> JobLog:
        return JobLog(**{**self.fields, **more})

    def info(self, event: str, **fields: Any) -> None:
        log(event, "info", **self.fields, **fields)

    def warning(self, event: str, **fields: Any) -> None:
        log(event, "warning", **self.fields, **fields)

    def error(self, event: str, **fields: Any) -> None:
        log(event, "error", **self.fields, **fields)
