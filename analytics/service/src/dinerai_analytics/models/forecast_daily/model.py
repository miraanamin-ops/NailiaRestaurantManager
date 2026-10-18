"""The nightly run (05:35 UK): re-fit on all history, forecast, back-test, decide pass or fail.

1. Read the restaurant's data (data.py) and prepare everything that doesn't depend
   on the issue time (design.Prepared).
2. Under 8 weeks of history: no forecasts, passed false (a success, so no alert).
   Sales older than 14 days at the issue time: the run fails (something is wrong upstream).
3. The choices made by back-test (evaluate.select), cached for 28 days.
4. The 12-week replay, re-fitted every night, and its scores with the benchmarks.
   The long back-test (report.long_backtest, about 50 cut-offs across the history)
   for the pass bar, cached for 28 days like the choices.
5. Today's forecast: 56 days daily, 14 days hourly, ranges calibrated on every
   back-test error.
6. Outputs: forecasts, model_coefficients (every weight with its prior), and
   forecast_drivers (the biggest reasons behind each day). passed = the pass bar.
"""

from __future__ import annotations

import datetime as dt
import math
import time
from dataclasses import dataclass

from ...cutoff import forecast_days
from ...registry import ModelResult, PermanentError, RunContext
from ..forecast_baseline import STALE_AFTER_DAYS
from . import data as fdata
from .about import NAME, VERSION
from .design import MIN_HISTORY_DAYS, Config, Prepared
from .evaluate import (
    LONG_HORIZON,
    Replay,
    actual_series,
    cached_long,
    cached_selection,
    hourly_actuals,
    origins_for,
    pass_bar,
    replay,
    score,
    select,
)
from .hourly import HourProfiles, hourly_counts
from .predict import Prediction, predict
from .report import long_backtest, long_summary

HOURLY_DAYS = 14


def make_profiles(prep: Prepared) -> HourProfiles:
    counts = {"all": hourly_counts(prep.data.hourly, "transactions")}
    for c in prep.channels:
        counts[c] = hourly_counts([r for r in prep.data.channel_hours if r["channel"] == c], "orders")
    prayer = {p["day"]: p for p in prep.data.prayer}
    usable = set(prep.y["all"]) - prep.unusual
    return HourProfiles(prep.hours, prep.static, prayer, counts, usable)


def forecast_rows(p: Prediction, hourly_days: int = HOURLY_DAYS) -> list[dict]:
    rows = []
    for (metric, ch), by_t in p.daily.items():
        for t, (lo, li, hi) in sorted(by_t.items()):
            rows.append(_row(t, None, None, metric, ch, lo, li, hi))
    for (metric, ch), by_t in p.hourly.items():
        for t, hours in sorted(by_t.items()):
            if (t - p.issue_day).days >= hourly_days:
                continue
            for th, (lo, li, hi) in hours:
                rows.append(_row(t, th.start, th.hour, metric, ch, lo, li, hi))
    return rows


def _row(t, hour_start, local_hour, metric, channel, lo, li, hi) -> dict:
    lo, li, hi = round(float(lo), 2), round(float(li), 2), round(float(hi), 2)
    return {"target_day": t, "hour_start": hour_start, "local_hour": local_hour, "metric": metric, "channel": channel,
            "low": min(lo, li), "likely": li, "high": max(hi, li)}


def coefficient_rows(p: Prediction) -> list[dict]:
    rows = []
    of = p.origin
    for ch, ff in of.fits.items():
        d = of.designs[ch]
        sds = [math.sqrt(max(ff.cov[i, i], 0.0)) for i in range(len(ff.beta))]
        for i, name in enumerate(d.columns):
            rows.append({"channel": ch, "factor": name, "estimate": float(ff.beta[i]), "sd": sds[i],
                         "prior_mean": float(d.prior_mean[i]) if math.isfinite(d.prior_mean[i]) else None,
                         "prior_sd": float(d.prior_sd[i]) if math.isfinite(d.prior_sd[i]) else None})
        rows.append({"channel": ch, "factor": "log_theta", "estimate": ff.fit.log_theta, "sd": None, "prior_mean": math.log(20.0), "prior_sd": 1.5})
        rows.append({"channel": ch, "factor": "level_correction", "estimate": ff.correction, "sd": None, "prior_mean": None, "prior_sd": None})
    return rows


def driver_rows(p: Prediction) -> list[dict]:
    rows = []
    for ch, by_t in p.drivers.items():
        for t, items in sorted(by_t.items()):
            for factor, mult in items:
                rows.append({"target_day": t, "channel": ch, "factor": factor, "multiplier": round(float(mult), 4)})
    return rows


def _primary(scored: dict) -> dict:
    s = scored["series"].get(("orders", "all"), {})
    b = scored["benchmarks"]["baseline"].get(("orders", "all"), {})
    return {"metric": "orders", "channel": "all", **{k: s.get(k) for k in ("wape", "coverage", "bias", "n", "days")},
            "baseline_wape": b.get("wape"), "improvement": round(1 - s["wape"] / b["wape"], 4) if s.get("wape") and b.get("wape") else None}


def _series_list(series: dict) -> list[dict]:
    keep = ("wape", "coverage", "bias", "n", "days")
    return [{"metric": m, "channel": c, **{k: v[k] for k in keep}, "by_horizon": {b: {k: x[k] for k in keep} for b, x in v["by_horizon"].items()}}
            for (m, c), v in sorted(series.items())]


@dataclass
class Nightly:
    result: ModelResult
    prep: Prepared | None = None
    cfg: Config | None = None
    replay: Replay | None = None
    live: Prediction | None = None
    profiles: HourProfiles | None = None
    long: dict | None = None  # the full long back-test, when this run made it (not cached)


def run(ctx: RunContext) -> ModelResult:
    return nightly(ctx).result


def nightly(ctx: RunContext) -> Nightly:
    """The run, keeping its working parts (the report command draws charts from them)."""
    started = time.monotonic()
    timing = {}
    data = fdata.load(ctx.reader, ctx.restaurant_id, ctx.known_through, ctx.issue_time)
    timing["load_s"] = round(time.monotonic() - started, 2)
    prep = Prepared(data, ctx.issue_day, ctx.trading_day_cutoff_hour, LONG_HORIZON)
    span = prep.history_span(ctx.known_through)
    base_metrics = {"version": VERSION, "restaurant_type": prep.kind, "history_days": span, "channels": prep.channels,
                    "channel_shares": {c: round(v, 4) for c, v in prep.shares.items()},
                    "censoring": "seat capacity isn't recorded yet, so no day is treated as censored"}
    if span < MIN_HISTORY_DAYS:
        return Nightly(ModelResult(outputs={}, metrics={**base_metrics, "skipped": f"only {span} days of history (needs {MIN_HISTORY_DAYS}); no forecast"},
                                   score=None, passed=False), prep)
    latest = max(prep.y["all"])
    if (ctx.known_through - latest).days > STALE_AFTER_DAYS:
        raise PermanentError(f"The latest sales day is {latest}, more than {STALE_AFTER_DAYS} days before {ctx.known_through}")

    # The choices: from a recent run if made in the last 28 days, else made now.
    t = time.monotonic()
    prior = ctx.reader.rows("model_runs", ["model_version", "metrics", "data_cutoff"],
                            where=[("model_name", "=", NAME), ("status", "=", "succeeded"), ("data_cutoff", "<=", ctx.issue_time),
                                   ("data_cutoff", ">", ctx.issue_time - dt.timedelta(days=28))])
    selection = cached_selection(prior, ctx.issue_time, VERSION)
    cached = selection is not None
    if selection is None:
        selection = select(prep, ctx.issue_day, ctx.trading_day_cutoff_hour, ctx.restaurant_id)
    cfg = Config.from_dict(selection["config"])
    timing["selection_s"] = round(time.monotonic() - t, 2)

    # The 12-week replay.
    t = time.monotonic()
    profiles = make_profiles(prep)
    actuals = actual_series(prep)
    hourly_act = hourly_actuals(prep)
    warmup, scored_origins = origins_for(ctx.issue_day, ctx.trading_day_cutoff_hour)
    rp = replay(prep, cfg, warmup + scored_origins, ctx.trading_day_cutoff_hour, ctx.restaurant_id, profiles, actuals, hourly_act)
    timing["replay_s"] = round(time.monotonic() - t, 2)
    t = time.monotonic()
    scored = score(prep, rp, ctx.issue_day, ctx.trading_day_cutoff_hour, actuals, hourly_act)
    timing["scoring_s"] = round(time.monotonic() - t, 2)

    # The long back-test: from a recent run if made in the last 28 days, else made now.
    t = time.monotonic()
    long_full = None
    long = cached_long(prior, ctx.issue_time, VERSION)
    long_cached = long is not None
    if long is None:
        long_full = long_backtest(prep, ctx.trading_day_cutoff_hour, ctx.restaurant_id, profiles)
        long = long_summary(long_full, ctx.issue_day)
    timing["long_backtest_s"] = round(time.monotonic() - t, 2)
    bar = pass_bar(prep, scored, span, long)

    # Today's forecast.
    t = time.monotonic()
    last = rp.predictions[max(rp.predictions)] if rp.predictions else None
    live = predict(prep, cfg, ctx.issue_time, ctx.known_through, forecast_days(ctx.issue_day, LONG_HORIZON), ctx.restaurant_id, profiles,
                   rp.calibration, None, last.warm if last else None, HOURLY_DAYS, with_drivers=True)
    rows = forecast_rows(live)
    timing["forecast_s"] = round(time.monotonic() - t, 2)
    timing["total_s"] = round(time.monotonic() - started, 2)

    primary = _primary(scored)
    metrics = {
        **base_metrics,
        "role_note": "production: shown to the owner only when this run passed",
        "config": cfg.to_dict(),
        "selection": {**selection, "cached": cached},
        "primary": primary,
        "series": _series_list(scored["series"]),
        "hourly": scored["hourly"],
        "special_days": scored["special_days"],
        "benchmarks": {name: _series_list(s) for name, s in scored["benchmarks"].items()},
        "pass": bar,
        "long_backtest": {**long, "cached": long_cached},
        "calibration": {"q": rp.calibration.table(), "n": rp.calibration.counts()},
        "backtest": {**scored["window"], "warmup_days": len(warmup), "refit": "every night, warm-started", "long_range": "every 7th night to day 55"},
        "forecast": {"issue_day": ctx.issue_day.isoformat(), "known_through": ctx.known_through.isoformat(), "rows": len(rows),
                     "method": live.method, "weather_source": dict(_count(live.origin.designs[next(iter(live.origin.designs))].weather_source))},
        "timing": timing,
        "notes": sorted({*prep.notes, *(n for d in live.origin.designs.values() for n in d.notes)}),
    }
    result = ModelResult(outputs={"forecasts": rows, "model_coefficients": coefficient_rows(live), "forecast_drivers": driver_rows(live)},
                         metrics=metrics, score=primary["wape"], passed=bar["passed"])
    return Nightly(result, prep, cfg, rp, live, profiles, long_full)


def _count(items):
    out = {}
    for x in items:
        out[x] = out.get(x, 0) + 1
    return out.items()
