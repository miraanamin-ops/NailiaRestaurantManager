"""Models used only by the tests (loaded with EXTRA_MODELS=dinerai_test_models, dev only).

  test_fail       always fails (retried, then dead)
  test_permanent  fails in a way retrying can't fix (dead at once)
  test_slow       sleeps payload["sleep"] seconds (default 0.5), writes nothing
  test_timeout    sleeps far longer than its 2-second budget
  test_heartbeat  like test_slow, on a job type with a 3-second lock (heartbeats must keep it)
"""

from __future__ import annotations

import time

from dinerai_analytics.registry import ModelResult, ModelSpec, PermanentError, Registry


def _fail(ctx):
    raise RuntimeError("model diverged")


def _permanent(ctx):
    raise PermanentError("no usable data")


def _slow(ctx):
    time.sleep(float(ctx.payload.get("sleep", 0.5)))
    return ModelResult(outputs={}, metrics={"slept": ctx.payload.get("sleep", 0.5)}, score=None, passed=True)


def _timeout(ctx):
    time.sleep(60)
    return ModelResult(outputs={}, metrics={}, score=None, passed=True)


def _spec(name, run, budget=30):
    return ModelSpec(name=name, version="0.0.1", kind="other", role="benchmark", job_type=name, views=("sales_daily",), run=run, time_budget_s=budget)


SPECS = [_spec("test_fail", _fail), _spec("test_permanent", _permanent), _spec("test_slow", _slow), _spec("test_timeout", _timeout, budget=2),
         _spec("test_heartbeat", _slow)]


def register_models(reg: Registry) -> None:
    for s in SPECS:
        reg.register(s)
