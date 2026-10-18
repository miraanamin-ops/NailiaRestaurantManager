"""The benchmarks every forecast is reported against, on the same targets.

  last_week  the same weekday in the latest week known (no range)
  baseline   forecast_baseline's rule (average of the same weekday in the last 4 known weeks,
             low/high = their min/max), called directly
  ets        exponential smoothing: additive weekly seasonality on log(orders + 1), level and
             seasonal smoothing chosen from a small grid by the one-step squared error over
             the year before each cut-off; range +/- 1.28 sd of those one-step errors

The smoothing filter only ever moves forward through known days, so its state at a
cut-off uses nothing later; the grid choice uses the errors up to that cut-off.
"""

from __future__ import annotations

import bisect
import datetime as dt
import math
from dataclasses import dataclass

import numpy as np

from ..forecast_baseline import predict as baseline_predict

ALPHAS = (0.05, 0.1, 0.2, 0.3, 0.5)
GAMMAS = (0.05, 0.1, 0.2, 0.3)
SSE_DAYS = 365
Z80 = 1.2816


def last_week(series: dict[dt.date, float], target: dt.date, kt: dt.date) -> tuple[float, float, float] | None:
    back = (target - kt).days
    d = target - dt.timedelta(days=7 * max(1, -(-back // 7)))
    v = series.get(d)
    return None if v is None else (v, v, v)


def baseline(series: dict[dt.date, float], target: dt.date, kt: dt.date):
    return baseline_predict(series, target, kt)


@dataclass
class _Path:
    days: list[dt.date]
    level: np.ndarray
    season: np.ndarray  # (n, 7) the seasonal state after each day
    err2: np.ndarray  # running total of squared one-step errors
    err2_n: np.ndarray


class ETS:
    def __init__(self, series: dict[dt.date, float]):
        self.days = sorted(series)
        self.paths: dict[tuple[float, float], _Path] = {}
        if len(self.days) < 21:
            return
        y = np.log(np.array([series[d] for d in self.days]) + 1.0)
        start = y[:14]
        wd = np.array([d.weekday() for d in self.days])
        level0 = float(start.mean())
        season0 = np.zeros(7)
        for k in range(7):
            vals = start[wd[:14] == k]
            if len(vals):
                season0[k] = float(vals.mean()) - level0
        for a in ALPHAS:
            for g in GAMMAS:
                lv, s = level0, season0.copy()
                L, S, E, N = np.zeros(len(y)), np.zeros((len(y), 7)), np.zeros(len(y)), np.zeros(len(y))
                total, count = 0.0, 0
                for i, (v, k) in enumerate(zip(y, wd, strict=True)):
                    e = v - (lv + s[k])
                    if i >= 14:
                        total += e * e
                        count += 1
                    lv_new = lv + a * e
                    s[k] = s[k] + g * (v - lv_new - s[k])
                    lv = lv_new
                    L[i], S[i], E[i], N[i] = lv, s, total, count
                self.paths[(a, g)] = _Path(self.days, L, S, E, N)

    def predict(self, target: dt.date, kt: dt.date) -> tuple[float, float, float] | None:
        i = bisect.bisect_right(self.days, kt) - 1
        if i < 21 or not self.paths:
            return None
        j = bisect.bisect_right(self.days, kt - dt.timedelta(days=SSE_DAYS)) - 1
        best, best_sse, best_sd = None, math.inf, 0.0
        for key, p in self.paths.items():
            sse = p.err2[i] - (p.err2[j] if j >= 0 else 0.0)
            n = p.err2_n[i] - (p.err2_n[j] if j >= 0 else 0.0)
            if n > 0 and sse / n < best_sse:
                best, best_sse, best_sd = key, sse / n, math.sqrt(sse / n)
        if best is None:
            return None
        p = self.paths[best]
        h = max(1, (target - kt).days)
        mean = p.level[i] + p.season[i][target.weekday()]
        sd = best_sd * math.sqrt(1 + (h - 1) * best[0] ** 2)
        low, likely, high = (max(math.exp(x) - 1.0, 0.0) for x in (mean - Z80 * sd, mean, mean + Z80 * sd))
        return low, likely, high


BENCHMARKS = ("last_week", "baseline", "ets")
