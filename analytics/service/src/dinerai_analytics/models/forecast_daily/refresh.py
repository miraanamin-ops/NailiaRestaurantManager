"""The 07:00 refresh (forecast_refresh): days 0 to 2 again with the latest weather forecast and
calendar, no re-fit.

It takes today's latest succeeded forecast_daily run (none: it writes nothing) and
that run's weights (model_coefficients). For each channel and day it works out the
expected orders twice with those same weights: with the features as they were at
05:35 and as they are now (the newest weather forecast; the calendar as it is now,
so a confirmed moon sighting moves Eid). The ratio rescales that run's forecasts:
  orders per channel     low, likely, high x the channel's ratio
  orders all             the channels' sum (direct method: the all model's ratio,
                         channels scaled to it)
  sales, covers          x the ratio of orders all / dine-in
  hours                  each channel's hours re-split from the 05:35 shares so they
                         add up exactly; the all-channel hours are the sum of the
                         channels' (small channels, never written hourly, are the
                         all-channel hours minus the shown channels')
passed is copied from that run and the run is recorded in the metrics. The ranges
keep their 05:35 width relative to the likely value.
"""

from __future__ import annotations

import datetime as dt
import math
from collections import defaultdict

import numpy as np

from ...cutoff import LONDON, UTC, forecast_days, known_through
from ...registry import ModelResult, RunContext
from . import data as fdata
from .about import NAME as DAILY_NAME
from .about import REFRESH_DAYS, VERSION
from .design import Config, Prepared
from .forecast import FullFit, contributions, top_drivers
from .hourly import split_exact
from .nb import Fit


def _expected(d, beta: np.ndarray, correction: float) -> np.ndarray:
    return np.array([sum(p * math.exp(float(x @ beta) + d.target_offset[i] + correction) for p, x in opts) if d.target_open[i] else 0.0
                     for i, opts in enumerate(d.target_rows)])


def _beta_for(columns: list[str], coefs: dict[str, float], prior_mean: np.ndarray) -> np.ndarray:
    """The 05:35 weights by column name; a column it didn't have (a deal sent since) takes its prior."""
    return np.array([coefs.get(c, prior_mean[i] if math.isfinite(prior_mean[i]) else 0.0) for i, c in enumerate(columns)])


def run(ctx: RunContext) -> ModelResult:
    day_start = dt.datetime.combine(ctx.issue_day, dt.time(0), tzinfo=LONDON).astimezone(UTC)
    runs = ctx.reader.rows("model_runs", ["id", "model_version", "passed", "metrics", "data_cutoff"],
                           where=[("model_name", "=", DAILY_NAME), ("status", "=", "succeeded"), ("data_cutoff", ">=", day_start),
                                  ("data_cutoff", "<=", ctx.issue_time)], order_by=["data_cutoff"])
    if not runs:
        return ModelResult(outputs={}, metrics={"note": f"no succeeded {DAILY_NAME} run today ({ctx.issue_day}); nothing refreshed"}, score=None, passed=False)
    base = runs[-1]
    base_id = str(base["id"])
    cfg = Config.from_dict((base["metrics"] or {}).get("config") or {})
    coef_rows = ctx.reader.rows("model_coefficients", ["channel", "factor", "estimate"], where=[("model_run_id", "=", base_id)])
    if not coef_rows:
        return ModelResult(outputs={}, metrics={"note": "that run has no coefficients (no forecast); nothing refreshed", "base_run_id": base_id},
                           score=None, passed=False)
    coefs: dict[str, dict[str, float]] = defaultdict(dict)
    for r in coef_rows:
        coefs[r["channel"]][r["factor"]] = float(r["estimate"])
    targets = forecast_days(ctx.issue_day, REFRESH_DAYS)
    old_rows = ctx.reader.rows("forecasts", ["target_day", "hour_start", "local_hour", "metric", "channel", "low", "likely", "high"],
                               where=[("model_run_id", "=", base_id), ("target_day", "<=", targets[-1])])

    base_issue = base["data_cutoff"]
    kt = known_through(base_issue, ctx.trading_day_cutoff_hour)
    data = fdata.load(ctx.reader, ctx.restaurant_id, kt, ctx.issue_time)
    prep = Prepared(data, ctx.issue_day, ctx.trading_day_cutoff_hour, REFRESH_DAYS)

    # The ratio of expected orders now to at 05:35, per channel and day, with the same weights.
    ratio: dict[str, np.ndarray] = {}
    drivers = []
    for ch, cf in coefs.items():
        old = prep.design(cfg, ch, base_issue, kt, targets)
        new = prep.design(cfg, ch, ctx.issue_time, kt, targets)
        corr = cf.get("level_correction", 0.0)
        b_old, b_new = _beta_for(old.columns, cf, old.prior_mean), _beta_for(new.columns, cf, new.prior_mean)
        mo, mn = _expected(old, b_old, corr), _expected(new, b_new, corr)
        ratio[ch] = np.divide(mn, mo, out=np.where(mn > 0, 1.0, 0.0), where=mo > 0)
        theta = math.exp(cf.get("log_theta", math.log(20)))
        ff = FullFit(b_new, np.zeros((len(b_new), len(b_new))), theta, Fit(b_new, 0.0, np.zeros((1, 1)), True, 0, 0.0), corr)
        contrib = contributions(new, ff)
        for i, t in enumerate(targets):
            for factor, mult in top_drivers(contrib[i]):
                drivers.append({"target_day": t, "channel": ch, "factor": factor, "multiplier": round(float(mult), 4)})

    rows = refreshed_rows(old_rows, ratio, targets, method=(base["metrics"] or {}).get("forecast", {}).get("method", "sum"))
    metrics = {"version": VERSION, "base_run_id": base_id, "base_issued_at": base_issue.isoformat(), "base_passed": base["passed"],
               "ratios": {ch: [round(float(x), 4) for x in r] for ch, r in ratio.items()}, "days": [t.isoformat() for t in targets],
               "rows": len(rows), "method": "same weights as the 05:35 run; features rebuilt from the latest weather forecast and calendar"}
    return ModelResult(outputs={"forecasts": rows, "forecast_drivers": drivers}, metrics=metrics,
                       score=(base["metrics"] or {}).get("primary", {}).get("wape"), passed=bool(base["passed"]))


def _rescaled(r: dict, likely: float) -> dict:
    """A row with a new likely value; low and high keep their distance from it in proportion."""
    old = float(r["likely"])
    f = likely / old if old else 1.0
    lo, hi = round(float(r["low"]) * f, 2), round(float(r["high"]) * f, 2)
    return {**r, "low": min(lo, likely), "likely": likely, "high": max(hi, likely)}


def _likely(r: dict | None) -> float:
    return float(r["likely"]) if r else 0.0


def refreshed_rows(old_rows: list[dict], ratio: dict[str, np.ndarray], targets: list[dt.date], method: str = "sum") -> list[dict]:
    """The 05:35 rows for the target days, rescaled (see the module notes). Pure, so it is tested on its own."""
    idx = {t: i for i, t in enumerate(targets)}
    daily: dict[tuple, dict] = {}
    hourly: dict[tuple, list[dict]] = defaultdict(list)
    for r in old_rows:
        if r["target_day"] not in idx:
            continue
        key = (r["metric"], r["channel"], r["target_day"])
        if r["hour_start"] is None:
            daily[key] = r
        else:
            hourly[key].append(r)
    for hs in hourly.values():
        hs.sort(key=lambda r: r["hour_start"])
    channels = sorted({c for (m, c, _) in daily if m == "orders" and c != "all"})
    out: list[dict] = []
    for t in targets:
        i = idx[t]
        k = {c: float(ratio[c][i]) if c in ratio else 1.0 for c in channels}
        new = {c: round(_likely(daily[("orders", c, t)]) * k[c], 2) for c in channels if ("orders", c, t) in daily}
        r_all = daily.get(("orders", "all", t))
        if method == "direct" and "all" in ratio and r_all is not None and sum(new.values()) > 0:
            # The direct model's ratio sets the total; the channels are scaled to it.
            target = _likely(r_all) * float(ratio["all"][i])
            scale = target / sum(new.values())
            new = {c: round(v * scale, 2) for c, v in new.items()}
        all_new = round(sum(new.values()), 2) if new else round(_likely(r_all) * float(ratio.get("all", np.ones(len(targets)))[i]), 2)
        out.extend(_rescaled(daily[("orders", c, t)], v) for c, v in new.items())
        if r_all is not None:
            out.append(_rescaled(r_all, all_new))
        # Sales follow orders/all, covers follow dine-in.
        k_all = all_new / _likely(r_all) if _likely(r_all) else 1.0
        old_din = _likely(daily.get(("orders", "dine_in", t)))
        k_din = new["dine_in"] / old_din if "dine_in" in new and old_din else k_all
        new_daily = {}
        for (m, c, day), r in daily.items():
            if day == t and m != "orders":
                new_daily[(m, c)] = round(_likely(r) * (k_all if m == "sales_pence" else k_din), 2)
                out.append(_rescaled(r, new_daily[(m, c)]))

        # Hours: each shown channel re-split from its own shares; the all-channel hours are the shown channels'
        # hours plus the rest (the small channels, together) re-split from the rest's shares.
        shown = [c for c in channels if hourly.get(("orders", c, t))]
        new_h = {c: _resplit(hourly[("orders", c, t)], new[c]) for c in shown}
        hours_all = hourly.get(("orders", "all", t), [])
        if hours_all:
            by_hour = {c: {x["hour_start"]: float(x["likely"]) for x in hourly[("orders", c, t)]} for c in shown}
            new_by_hour = {c: {x["hour_start"]: float(x["likely"]) for x in new_h[c]} for c in shown}
            rest_old = np.array([float(h["likely"]) - sum(by_hour[c].get(h["hour_start"], 0.0) for c in shown) for h in hours_all])
            rest_total = round(all_new - sum(new[c] for c in shown), 2)
            rest_new = split_exact(rest_total, rest_old / rest_old.sum()) if rest_old.sum() > 0 else np.zeros(len(hours_all))
            for j, h in enumerate(hours_all):
                li = round(float(rest_new[j]) + sum(new_by_hour[c].get(h["hour_start"], 0.0) for c in shown), 2)
                out.append(_rescaled(h, li))
        for c in shown:
            out.extend(new_h[c])
        for (m, c, day), hs in hourly.items():
            if day == t and m != "orders" and (m, c) in new_daily:
                out.extend(_resplit(hs, new_daily[(m, c)]))
    return out


def _resplit(hours: list[dict], new_total: float) -> list[dict]:
    """The hours re-split so they add up exactly to the new day total, keeping their shares."""
    old = np.array([float(h["likely"]) for h in hours])
    shares = old / old.sum() if old.sum() > 0 else np.full(len(hours), 1 / max(len(hours), 1))
    return [_rescaled(h, float(li)) for h, li in zip(hours, split_exact(new_total, shares), strict=True)]
