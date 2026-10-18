"""The demand forecast (forecast_daily, role production) and its 07:00 refresh (forecast_refresh).

No AI: a negative binomial regression per channel with Normal priors (the editable
defaults in defaults/), fitted nightly on all history, with simulated and calibrated
ranges, an hour profile, and sales and covers derived from orders. See README.md in
analytics/service for how to run it, and each module's notes:

  data.py              what it reads
  hours.py             opening hours, hours open, till hours on the real clock
  calendar_factors.py  calendar and religious factors (uncertain dates as scenarios)
  weather.py           weather factors, as issued
  events.py            sport matches, venue crowds, disruption
  actions.py           deals and the price index
  defaults.py          the priors per restaurant type
  design.py            the design matrix and priors per origin and channel
  nb.py                the fit (MAP) and the parameter draws
  forecast.py          fitting every channel and simulating
  hourly.py            the hour profile
  derived.py           sales and covers
  ranges.py            quantiles and calibration
  predict.py           everything for one origin, adding up exactly
  benchmarks.py        last week, the baseline, exponential smoothing
  evaluate.py          the back-test, the choices, the pass bar
  about.py             its name and version
  model.py             the nightly run
  refresh.py           the 07:00 refresh
"""

from __future__ import annotations

from ...registry import ModelSpec
from .about import NAME, REFRESH_DAYS, REFRESH_NAME, VERSION
from .data import HISTORY_DAYS, VIEWS


# The maths (numpy, scipy) loads only when a job of this model runs, so every other job's process starts quickly.
def _run(ctx):
    from .model import run

    return run(ctx)


def _refresh(ctx):
    from .refresh import run

    return run(ctx)


SPEC = ModelSpec(
    name=NAME,
    version=VERSION,
    kind="forecast",
    role="production",
    job_type="forecast_daily",
    views=VIEWS,
    run=_run,
    time_budget_s=600,
    history_days=HISTORY_DAYS,
    backtest_metric="WAPE",
    params={"horizon_days": 56, "hourly_days": 14, "backtest_weeks": 12, "draws": 500, "half_life_weeks": 26, "venue_lambda_km": 2.0},
)

REFRESH_SPEC = ModelSpec(
    name=REFRESH_NAME,
    version=VERSION,
    kind="forecast",
    role="production",
    job_type="forecast_refresh",
    views=(*VIEWS, "forecasts"),
    run=_refresh,
    time_budget_s=180,
    history_days=HISTORY_DAYS,
    backtest_metric="WAPE",
    params={"days": REFRESH_DAYS, "refit": False},
)
