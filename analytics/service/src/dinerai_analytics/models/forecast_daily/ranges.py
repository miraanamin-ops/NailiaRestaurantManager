"""Ranges: P10, P50, P90 from the simulation, then calibrated.

Quantiles of whole-number draws are taken with a small fixed jitter (+/- 0.5,
seeded), which gives the mid-distribution quantile: a smooth P50 that doesn't
stick to whole numbers (so channels and hours add up without a rounding bias).

Calibration (scaled split-conformal), separately per metric, channel and horizon
bucket (0-2, 3-6, 7-13, 14-55 days): each back-test forecast gives a score, how
far the actual fell outside the likely value in units of the simulated half-range
on that side; q is the 80% quantile of those scores (with the (n + 1) correction),
and the calibrated range is likely - q (likely - P10) to likely + q (P90 - likely).
So, on the back-test, about 80% of actuals fall in the range. The scores are those
of the last 8 weeks of known targets (all known ones while there are too few), so
the ranges follow the error level through the year. With fewer than MIN_SCORES
scores q stays 1 (the simulation as it is).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

BUCKETS = (("0-2", 0, 2), ("3-6", 3, 6), ("7-13", 7, 13), ("14-55", 14, 55))
COVER = 0.80
MIN_SCORES = 20
RECENT_DAYS = 56  # calibrate on the last 8 weeks of known targets (the same window as spend per order)
Q_LIMITS = (0.25, 6.0)


def bucket_of(h: int) -> str:
    for name, lo, hi in BUCKETS:
        if lo <= h <= hi:
            return name
    return BUCKETS[-1][0]


def quantiles(draws: np.ndarray, rng: np.random.Generator, ps=(0.1, 0.5, 0.9)) -> np.ndarray:
    """(S, T) draws -> (len(ps), T)."""
    if draws.size == 0:
        return np.zeros((len(ps), draws.shape[1] if draws.ndim == 2 else 0))
    jitter = rng.uniform(-0.5, 0.5, size=draws.shape)
    return np.quantile(np.maximum(draws + jitter, 0.0), ps, axis=0)


def score(actual: float, low: float, likely: float, high: float) -> float:
    if actual >= likely:
        return (actual - likely) / max(high - likely, 0.5)
    return (likely - actual) / max(likely - low, 0.5)


def conformal_q(scores: list[float]) -> float:
    n = len(scores)
    if n < MIN_SCORES:
        return 1.0
    k = min(n, math.ceil((n + 1) * COVER))
    q = float(np.sort(scores)[k - 1])
    return min(max(q, Q_LIMITS[0]), Q_LIMITS[1])


def apply(low: float, likely: float, high: float, q: float) -> tuple[float, float, float]:
    lo = max(0.0, likely - q * (likely - low))
    hi = likely + q * (high - likely)
    return min(lo, likely), likely, max(hi, likely)


@dataclass
class Calibration:
    """Scores collected from back-test forecasts, each with the trading day its target became known."""

    records: dict[tuple[str, str, str], list[tuple]] = field(default_factory=lambda: defaultdict(list))

    def add(self, metric: str, channel: str, horizon: int, target, actual: float, low: float, likely: float, high: float) -> None:
        self.records[(metric, channel, bucket_of(horizon))].append((target, score(actual, low, likely, high)))

    def q(self, metric: str, channel: str, horizon: int, known_through=None) -> float:
        """q from the scores of targets in the RECENT_DAYS up to known_through (the latest scored target if None),
        so the ranges follow the error level as it changes through the year; all known scores if the recent
        ones are too few. Never a score whose target wasn't known by known_through."""
        recs = self.records.get((metric, channel, bucket_of(horizon)), [])
        known = [(t, s) for t, s in recs if known_through is None or t <= known_through]
        if not known:
            return 1.0
        last = known_through or max(t for t, _ in known)
        recent = [s for t, s in known if (last - t).days < RECENT_DAYS]
        return conformal_q(recent if len(recent) >= MIN_SCORES else [s for _, s in known])

    def table(self) -> dict[str, float]:
        """q per series and bucket as the live forecast uses it."""
        out = {}
        for m, c, b in sorted(self.records):
            h = next(lo for name, lo, _ in BUCKETS if name == b)
            out[f"{m}/{c}/{b}"] = round(self.q(m, c, h), 3)
        return out

    def counts(self) -> dict[str, int]:
        return {f"{m}/{c}/{b}": len(v) for (m, c, b), v in sorted(self.records.items())}
