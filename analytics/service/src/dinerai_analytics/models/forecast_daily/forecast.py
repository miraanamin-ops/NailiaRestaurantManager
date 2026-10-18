"""One origin's forecast: fit each channel (and the direct all-channel model), then simulate.

Draws: weights from the Laplace approximation (parameter uncertainty), then a
negative binomial count per draw (S = 500). Weights with no data in the training
rows stay at their prior (mean and sd). With an uncertain religious date near,
each draw takes one of the date scenarios at its probability, so the range
widens where the date is in doubt. Seeds come from the restaurant, the issue day,
the channel and the purpose, so the same inputs always give the same numbers.
"""

from __future__ import annotations

import datetime as dt
import math
import zlib
from dataclasses import dataclass

import numpy as np

from .design import CHANNELS, Config, Design, Prepared
from .nb import Fit, draw_beta, draw_counts, fit_nb

DRAWS = 500
CORRECTION_CLIP = 0.5
TOP_DRIVERS = 6
DRIVER_MIN = 0.01  # under 1% isn't worth explaining
PRICE_DRIVER_DAYS = 84  # a price change shows as a driver for 12 weeks


def rng_for(restaurant_id: str, issue_day: dt.date, channel: str, purpose: str = "forecast") -> np.random.Generator:
    return np.random.default_rng([zlib.crc32(restaurant_id.encode()), issue_day.toordinal(), zlib.crc32(channel.encode()), zlib.crc32(purpose.encode())])


@dataclass
class FullFit:
    beta: np.ndarray  # every column (inactive ones at their prior mean)
    cov: np.ndarray
    theta: float
    fit: Fit
    correction: float  # added to log mu (recent-level correction; 0 with decay weights)


def fit_design(d: Design, cfg: Config, init: np.ndarray | None = None) -> FullFit:
    a = d.active
    theta_prior = (math.log(20.0), 1.5)
    f = fit_nb(d.X[:, a], d.y, d.offset, d.w, d.prior_mean[a], d.prior_sd[a], theta_prior, init)
    beta = np.where(np.isfinite(d.prior_mean), d.prior_mean, 0.0).copy()
    beta[a] = f.beta
    p = len(beta)
    cov = np.zeros((p, p))
    ia = np.flatnonzero(a)
    cov[np.ix_(ia, ia)] = f.cov
    for i in np.flatnonzero(~a):
        cov[i, i] = d.prior_sd[i] ** 2 if np.isfinite(d.prior_sd[i]) else 0.0
    correction = 0.0
    if cfg.level == "correction" and len(d.train_days):
        last = d.train_days[-1]
        recent = np.array([(last - x).days < cfg.correction_days for x in d.train_days])
        fitted = np.exp(d.X[recent] @ beta + d.offset[recent])
        if recent.any() and fitted.sum() > 0 and d.y[recent].sum() > 0:
            correction = float(np.clip(math.log(d.y[recent].sum() / fitted.sum()), -CORRECTION_CLIP, CORRECTION_CLIP))
    return FullFit(beta, cov, f.theta, f, correction)


def simulate(d: Design, ff: FullFit, rng: np.random.Generator, draws: int = DRAWS) -> tuple[np.ndarray, np.ndarray]:
    """(count draws (S, T), mean of mu per target (T)). A closed day is 0."""
    T = len(d.targets)
    if T == 0:
        return np.zeros((draws, 0)), np.zeros(0)
    B = draw_beta_full(ff, draws, rng)
    mu = np.zeros((draws, T))
    for t, options in enumerate(d.target_rows):
        if not d.target_open[t]:
            continue
        if len(options) == 1:
            eta = B @ options[0][1]
        else:
            probs = np.array([p for p, _ in options])
            pick = rng.choice(len(options), size=draws, p=probs / probs.sum())
            etas = np.stack([B @ x for _, x in options], axis=1)
            eta = etas[np.arange(draws), pick]
        mu[:, t] = np.exp(np.clip(eta + d.target_offset[t] + ff.correction, -20, 20))
    counts = draw_counts(mu, ff.theta, rng)
    counts[:, ~d.target_open] = 0.0
    return counts, mu.mean(axis=0)


def draw_beta_full(ff: FullFit, n: int, rng: np.random.Generator) -> np.ndarray:
    return draw_beta(Fit(ff.beta, ff.fit.log_theta, ff.cov, True, 0, 0.0), n, rng)


def contributions(d: Design, ff: FullFit, price_ref: float = 0.0) -> list[dict[str, float]]:
    """Per target: each driver's log contribution (weekday and season as one item each)."""
    cols = d.columns
    wd = [i for i, c in enumerate(cols) if c.startswith("weekday_")]
    wd_mean = float(np.mean(ff.beta[wd]))
    out = []
    for t, options in enumerate(d.target_rows):
        x = sum(p * row for p, row in options)
        c: dict[str, float] = {}
        if not d.target_open[t]:
            out.append({"closed": -math.inf})
            continue
        for i, name in enumerate(cols):
            v = ff.beta[i] * x[i]
            if name in ("level", "trend") or v == 0:
                continue
            if name.startswith("weekday_"):
                c["weekday"] = c.get("weekday", 0.0) + v - (wd_mean if x[i] else 0.0)
            elif name.startswith("wd_summer_"):
                c["weekday"] = c.get("weekday", 0.0) + v
            elif name.startswith("season_"):
                c["season"] = c.get("season", 0.0) + v
            elif name == "log_price_index":
                c["prices"] = ff.beta[i] * (x[i] - price_ref)
            else:
                c[name] = v
        if d.target_offset[t]:
            c["hours_open"] = float(d.target_offset[t])
        out.append(c)
    return out


def top_drivers(contrib: dict[str, float], k: int = TOP_DRIVERS) -> list[tuple[str, float]]:
    """The biggest contributions as multipliers (1.25 = 25% more orders because of it)."""
    if "closed" in contrib:
        return []
    items = [(f, v) for f, v in contrib.items() if abs(v) >= math.log1p(DRIVER_MIN)]
    items.sort(key=lambda fv: -abs(fv[1]))
    return [(f, math.exp(v)) for f, v in items[:k]]


@dataclass
class OriginForecast:
    targets: list[dt.date]
    draws: dict[str, np.ndarray]  # channel (and 'all') -> (S, T)
    mean: dict[str, np.ndarray]
    fits: dict[str, FullFit]
    designs: dict[str, Design]
    all_method: str


def forecast_origin(prep: Prepared, cfg: Config, issue_time: dt.datetime, kt: dt.date, targets: list[dt.date], restaurant_id: str,
                    warm: dict[str, np.ndarray] | None = None, want_direct: bool | None = None, draws: int = DRAWS) -> OriginForecast:
    """Fit and simulate every channel for one origin. want_direct also fits the direct all-channel model
    (always when cfg.all_method is 'direct', or when there are no channel splits)."""
    from ...cutoff import london_day

    issue_day = london_day(issue_time)
    out_draws, means, fits, designs = {}, {}, {}, {}
    channels = list(prep.channels)
    direct = cfg.all_method == "direct" or not channels or bool(want_direct)
    for ch in [*channels, *(["all"] if direct else [])]:
        d = prep.design(cfg, ch, issue_time, kt, targets)
        if len(d.y) < 14:
            continue
        init = warm.get(ch) if warm else None
        if init is not None and len(init) != int(d.active.sum()) + 1:
            init = None
        ff = fit_design(d, cfg, init)
        c, m = simulate(d, ff, rng_for(restaurant_id, issue_day, ch), draws)
        out_draws[ch], means[ch], fits[ch], designs[ch] = c, m, ff, d
    present = [c for c in channels if c in out_draws]
    method = "direct" if (cfg.all_method == "direct" or not present) and "all" in out_draws else "sum"
    if present:
        out_draws["sum"], means["sum"] = sum(out_draws[c] for c in present), sum(means[c] for c in present)
    return OriginForecast(targets, out_draws, means, fits, designs, method)


def warm_start(of: OriginForecast) -> dict[str, np.ndarray]:
    """The fitted parameters (active columns and log theta) to start the next night's fit from."""
    return {ch: np.concatenate([ff.fit.beta, [ff.fit.log_theta]]) for ch, ff in of.fits.items()}


__all__ = ["CHANNELS", "DRAWS", "OriginForecast", "contributions", "fit_design", "forecast_origin", "rng_for", "simulate", "top_drivers", "warm_start"]
