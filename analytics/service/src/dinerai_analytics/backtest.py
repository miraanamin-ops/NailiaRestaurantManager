"""The rolling back-test every forecast model scores itself with.

It replays the last 12 weeks as if the model had run every night: for each past
day it "issues" at 03:05 UK time using only the trading days that had ended by
then (cutoff.py), forecasts that day and the 13 after it, and compares each
forecast with what really happened. Only targets inside the 12-week window that
were known by the real issue time are scored, and only days with trading data
(closed days are skipped).

The model supplies one function, predict_origin(origin_day, issue_time,
known_through) -> {series key: {target day: (low, likely, high)}}, and must use
nothing later than known_through. Everything else (origins, cut-offs, targets,
scoring) is here, which is what makes two models' numbers directly comparable.

Scores per series (a series is a (metric, channel) pair, e.g. ("orders", "all")):
  wape      sum of |actual - likely| / sum of actual (lower is better)
  coverage  share of actuals that fell between low and high
  bias      sum of (likely - actual) / sum of actual (positive = forecasts too high)
  n         forecasts scored; days = distinct target days scored
  by_horizon  the same for days 0 to 6 ahead and 7 to 13 ahead
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable, Hashable
from dataclasses import dataclass, field

from .cutoff import HORIZON_DAYS, issue_time_for, known_through

BACKTEST_WEEKS = 12
# A back-test counts as complete once at least this many of the 84 target days were scored.
MIN_SCORED_DAYS = 56
HORIZON_BUCKETS = (("0-6", 0, 6), ("7-13", 7, 13))

Interval = tuple[float, float, float]  # low, likely, high
PredictOrigin = Callable[[dt.date, dt.datetime, dt.date], dict[Hashable, dict[dt.date, Interval]]]


@dataclass
class _Acc:
    abs_err: float = 0.0
    err: float = 0.0
    actual: float = 0.0
    inside: int = 0
    n: int = 0
    days: set = field(default_factory=set)

    def add(self, target: dt.date, actual: float, p: Interval) -> None:
        low, likely, high = p
        self.abs_err += abs(actual - likely)
        self.err += likely - actual
        self.actual += abs(actual)
        self.inside += int(low <= actual <= high)
        self.n += 1
        self.days.add(target)

    def summary(self) -> dict:
        return {
            "wape": round(self.abs_err / self.actual, 4) if self.actual else None,
            "coverage": round(self.inside / self.n, 4) if self.n else None,
            "bias": round(self.err / self.actual, 4) if self.actual else None,
            "n": self.n,
            "days": len(self.days),
        }


@dataclass(frozen=True)
class Window:
    issue_day: dt.date
    targets_from: dt.date
    targets_to: dt.date  # the last trading day known at the real issue time
    origins: tuple[dt.date, ...]


def window(issue_day: dt.date, cutoff_hour: int, weeks: int = BACKTEST_WEEKS, horizon: int = HORIZON_DAYS) -> Window:
    targets_to = known_through(issue_time_for(issue_day), cutoff_hour)
    targets_from = issue_day - dt.timedelta(days=weeks * 7)
    first_origin = targets_from - dt.timedelta(days=horizon - 1)
    n = (targets_to - first_origin).days + 1
    return Window(issue_day, targets_from, targets_to, tuple(first_origin + dt.timedelta(days=i) for i in range(max(n, 0))))


def rolling_backtest(
    actuals: dict[Hashable, dict[dt.date, float]],
    predict_origin: PredictOrigin,
    issue_day: dt.date,
    cutoff_hour: int,
    weeks: int = BACKTEST_WEEKS,
    horizon: int = HORIZON_DAYS,
) -> dict:
    """Scores per series key, plus a description of the window."""
    w = window(issue_day, cutoff_hour, weeks, horizon)
    total = {k: _Acc() for k in actuals}
    buckets = {k: {name: _Acc() for name, _, _ in HORIZON_BUCKETS} for k in actuals}
    for origin in w.origins:
        issued = issue_time_for(origin)
        kt = known_through(issued, cutoff_hour)
        predictions = predict_origin(origin, issued, kt)
        for key, by_target in predictions.items():
            if key not in actuals:
                continue
            for target, p in by_target.items():
                h = (target - origin).days
                if not (0 <= h < horizon) or not (w.targets_from <= target <= w.targets_to):
                    continue
                actual = actuals[key].get(target)
                if actual is None:
                    continue
                total[key].add(target, actual, p)
                for name, lo, hi in HORIZON_BUCKETS:
                    if lo <= h <= hi:
                        buckets[key][name].add(target, actual, p)
    return {
        "window": {
            "weeks": weeks,
            "horizon_days": horizon,
            "targets_from": w.targets_from.isoformat(),
            "targets_to": w.targets_to.isoformat(),
            "origins": len(w.origins),
            "issue_time": "03:05 Europe/London on each origin day",
            "cutoff_rule": "a trading day is used once it has ended (next day at the restaurant's trading-day cut-off) before the issue time",
            "min_scored_days": MIN_SCORED_DAYS,
        },
        "series": {k: {**total[k].summary(), "by_horizon": {name: b.summary() for name, b in buckets[k].items()}} for k in actuals},
    }


def truncate(series: dict[dt.date, float], through: dt.date) -> dict[dt.date, float]:
    """Only the days a model may use."""
    return {d: v for d, v in series.items() if d <= through}
