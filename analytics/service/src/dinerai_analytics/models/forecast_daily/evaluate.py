"""The back-test, the benchmarks, the choices made by back-test, and the pass bar.

Replay (backtest.rolling_backtest's window): the last 12 weeks as if the model had
run at 05:35 UK each night, re-fitted every night (warm-started from the night
before) on the trading days known then, with weather as issued then, 14 days ahead.
Every 7th origin also forecasts days 14 to 55, for the long-range bucket. The replay
starts WARMUP_DAYS earlier so the calibration has errors to learn from; those
nights aren't scored. Each night's ranges are calibrated only with errors of
targets known by that night.

Choices made by back-test, on a separate selection window (weekly origins whose 14
days end before the 12-week window starts, so they never touch the scored days):
season K (2, 3, 4), the weekday x summer interaction, decay weights or a long
half-life plus the last 4 weeks' correction, and the sum of channels or a direct
all-channel model. A more complex choice must beat the simpler one by 2% (relative
WAPE on orders/all). Made again every 28 days; cached in the run's metrics between.
"""

from __future__ import annotations

import datetime as dt
import math
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from ...backtest import MIN_SCORED_DAYS, pooled, rolling_backtest, window
from ...cutoff import HORIZON_DAYS, issue_time_for, known_through
from ..forecast_baseline import build_series
from .benchmarks import ETS, baseline, last_week
from .design import Config, Prepared
from .forecast import fit_design
from .hourly import HourProfiles
from .predict import Prediction, hourly_channels, predict
from .ranges import BUCKETS, Calibration

LONG_HORIZON = 56
WARMUP_DAYS = 28
SELECTION_ORIGINS = 12
SELECTION_EVERY_DAYS = 28
MIN_GAIN = 0.02  # a more complex choice must win by 2% relative WAPE
PASS_IMPROVEMENT = 0.15  # orders/all WAPE at least 15% better than the baseline
COVERAGE_RANGE = (0.75, 0.85)
MAX_ABS_BIAS = 0.05
MIN_CHANNEL_SHARE = 0.15
SCORE_BUCKETS = tuple((n, lo, hi) for n, lo, hi in BUCKETS if hi < HORIZON_DAYS)
Key = tuple


def actual_series(prep: Prepared) -> dict:
    """The actuals, built exactly as forecast_baseline builds them (closed days left out)."""
    return build_series(prep.data.daily, prep.data.channels)


def hourly_actuals(prep: Prepared) -> dict:
    """{(metric, channel, till hour): {day: value}} for orders (all, channels) and sales and covers where recorded."""
    out: dict = defaultdict(dict)
    for r in prep.data.hourly:
        if r.get("transactions") is not None and r["day"] in prep.y["all"]:
            out[("orders", "all", int(r["hour"]))][r["day"]] = float(r["transactions"])
    for r in prep.data.channel_hours:
        if r.get("orders") is not None and r["day"] in prep.y["all"]:
            out[("orders", r["channel"], int(r["hour"]))][r["day"]] = out[("orders", r["channel"], int(r["hour"]))].get(r["day"], 0.0) + float(r["orders"])
    # A channel with no row in an hour of a trading day it traded on had 0 there.
    for c in prep.channels:
        days_with = {r["day"] for r in prep.data.channel_hours if r["channel"] == c}
        for (m, ch, h), by_day in list(out.items()):
            if m == "orders" and ch == "all":
                for d in by_day:
                    if d in days_with:
                        out[("orders", c, h)].setdefault(d, 0.0)
    return dict(out)


def special_days(prep: Prepared) -> dict[str, set[dt.date]]:
    s = prep.static

    def days(*names):
        return {d for n in names for d, v in s.get(n, {}).items() if v}

    return {
        "eid": days("eid_fitr_d1", "eid_fitr_d2", "eid_fitr_d3", "eid_adha_d1", "eid_adha_d2", "eid_adha_d3"),
        "ramadan": days("ramadan_1_10", "ramadan_11_20", "ramadan_last10"),
        "match": days("football_during", "football_after", "cricket_during", "cricket_after"),
    }


# --- the choices -------------------------------------------------------------------
def point_wape(prep: Prepared, cfg: Config, issue_day: dt.date, cutoff: int, restaurant_id: str) -> dict[str, float] | None:
    """orders/all WAPE of the point forecasts (sum of channels, and direct) on the selection window."""
    pass_start = issue_day - dt.timedelta(days=12 * 7)
    origins = [pass_start - dt.timedelta(days=HORIZON_DAYS + 7 * j) for j in range(SELECTION_ORIGINS)]
    err = {"sum": 0.0, "direct": 0.0}
    tot = 0.0
    used = 0
    for o in origins:
        it = issue_time_for(o)
        kt = known_through(it, cutoff)
        if prep.history_span(kt) < 56:
            continue
        targets = [o + dt.timedelta(days=h) for h in range(HORIZON_DAYS) if o + dt.timedelta(days=h) < pass_start]
        means = {}
        for ch in [*prep.channels, "all"]:
            d = prep.design(cfg, ch, it, kt, targets)
            if len(d.y) < 14:
                continue
            ff = fit_design(d, cfg)
            m = np.array([sum(p * math.exp(float(x @ ff.beta) + d.target_offset[i] + ff.correction) for p, x in opts) if d.target_open[i] else 0.0
                          for i, opts in enumerate(d.target_rows)])
            means[ch] = m
        if "all" not in means:
            continue
        summed = sum(means[c] for c in prep.channels if c in means) if prep.channels else means["all"]
        for i, t in enumerate(targets):
            a = prep.y["all"].get(t)
            if a is None or t in prep.unusual:
                continue
            err["sum"] += abs(a - summed[i])
            err["direct"] += abs(a - means["all"][i])
            tot += a
        used += 1
    if not tot or used < 4:
        return None
    return {k: v / tot for k, v in err.items()}


def select(prep: Prepared, issue_day: dt.date, cutoff: int, restaurant_id: str) -> dict:
    """The choices, made on the selection window, step by step from the simplest."""
    steps = []
    base = Config(k_season=2)
    r = point_wape(prep, base, issue_day, cutoff, restaurant_id)
    if r is None:
        return {"config": Config().to_dict(), "made_on": issue_day.isoformat(), "steps": [], "note": "not enough history for the selection window: defaults"}
    best, best_w = base, r
    steps.append({"try": "k_season=2", "wape_sum": round(r["sum"], 4), "wape_direct": round(r["direct"], 4)})
    for k in (3, 4):
        c = Config(k_season=k, wd_summer=best.wd_summer, level=best.level)
        w = point_wape(prep, c, issue_day, cutoff, restaurant_id)
        steps.append({"try": f"k_season={k}", "wape_sum": round(w["sum"], 4), "wape_direct": round(w["direct"], 4)} if w else {"try": f"k_season={k}"})
        if w and w["sum"] <= best_w["sum"] * (1 - MIN_GAIN):
            best, best_w = c, w
    for change in ({"wd_summer": True}, {"level": "correction"}):
        c = Config(**{**best.to_dict(), **change})
        w = point_wape(prep, c, issue_day, cutoff, restaurant_id)
        scores = {"wape_sum": round(w["sum"], 4), "wape_direct": round(w["direct"], 4)} if w else {}
        steps.append({"try": ", ".join(f"{k}={v}" for k, v in change.items()), **scores})
        if w and w["sum"] <= best_w["sum"] * (1 - MIN_GAIN):
            best, best_w = c, w
    if best_w["direct"] <= best_w["sum"] * (1 - MIN_GAIN):
        best = Config(**{**best.to_dict(), "all_method": "direct"})
    return {"config": best.to_dict(), "made_on": issue_day.isoformat(), "steps": steps,
            "wape_sum": round(best_w["sum"], 4), "wape_direct": round(best_w["direct"], 4)}


def cached_selection(prior_runs: list[dict], issue_time: dt.datetime, version: str) -> dict | None:
    """The latest selection from a run of this version made in the 28 days before this issue time."""
    best = None
    for r in prior_runs:
        sel = (r.get("metrics") or {}).get("selection")
        if not sel or r.get("model_version") != version or not r.get("data_cutoff"):
            continue
        if not (issue_time - dt.timedelta(days=SELECTION_EVERY_DAYS) < r["data_cutoff"] <= issue_time):
            continue
        made = dt.date.fromisoformat(sel["made_on"])
        if (issue_time.date() - made).days >= SELECTION_EVERY_DAYS:
            continue
        if best is None or r["data_cutoff"] > best[0]:
            best = (r["data_cutoff"], sel)
    return best[1] if best else None


# --- the replay ----------------------------------------------------------------------
@dataclass
class Replay:
    predictions: dict[dt.date, Prediction] = field(default_factory=dict)
    calibration: Calibration = field(default_factory=Calibration)
    seconds: float = 0.0


def replay(prep: Prepared, cfg: Config, origins: list[dt.date], cutoff: int, restaurant_id: str, profiles: HourProfiles,
           actuals: dict, hourly_act: dict, long_every: int = 7, hourly_days: int = 14) -> Replay:
    import time

    t0 = time.monotonic()
    out = Replay()
    warm = None
    for i, o in enumerate(origins):
        it = issue_time_for(o)
        kt = known_through(it, cutoff)
        if prep.history_span(kt) < 56:
            continue
        horizon = LONG_HORIZON if i % long_every == 0 else HORIZON_DAYS
        targets = [o + dt.timedelta(days=h) for h in range(horizon)]
        p = predict(prep, cfg, it, kt, targets, restaurant_id, profiles, out.calibration, kt, warm, hourly_days)
        warm = p.warm
        out.predictions[o] = p
        _record(out.calibration, p, o, actuals, hourly_act)
    out.seconds = time.monotonic() - t0
    return out


def _record(cal: Calibration, p: Prediction, origin: dt.date, actuals: dict, hourly_act: dict) -> None:
    """Calibration scores (raw ranges) for every forecast whose actual exists. Each is only used once its target is known."""
    for (metric, ch), by_t in p.raw.items():
        a = actuals.get((metric, ch))
        if a is None:
            continue
        for t, (lo, li, hi) in by_t.items():
            v = a.get(t)
            if v is not None:
                cal.add(metric, ch, (t - origin).days, t, v, lo, li, hi)
    for (metric, ch), by_t in p.hourly_raw.items():
        name = {"orders": "orders_hourly", "sales_pence": "sales_hourly", "covers": "covers_hourly"}[metric]
        if metric != "orders":
            continue  # hourly sales and covers aren't recorded per hour (net) in the actuals; their days are calibrated
        for t, hours in by_t.items():
            for th, (lo, li, hi) in hours:
                v = hourly_act.get((metric, ch, th.hour), {}).get(t)
                if v is not None:
                    cal.add(name, ch, (t - origin).days, t, v, lo, li, hi)


# --- scoring -------------------------------------------------------------------------
def score(prep: Prepared, rp: Replay, issue_day: dt.date, cutoff: int, actuals: dict, hourly_act: dict) -> dict:
    """Every metric from the replay, by channel and horizon, with the benchmarks side by side."""
    keys = [k for k in actuals if k[0] in ("orders", "sales_pence", "covers")]

    def from_cache(origin, issued, kt):
        p = rp.predictions.get(origin)
        return {} if p is None else {k: v for k, v in p.daily.items() if k in actuals}

    bt = rolling_backtest({k: actuals[k] for k in keys}, from_cache, issue_day, cutoff, horizon_buckets=SCORE_BUCKETS)
    series = {k: bt["series"][k] for k in keys}

    # The long-range bucket (days 14 to 55, from every 7th night).
    long_bt = rolling_backtest({k: actuals[k] for k in keys}, lambda o, i, k: from_cache(o, i, k), issue_day, cutoff, horizon=LONG_HORIZON,
                               horizon_buckets=(("14-55", 14, 55),))
    for k in keys:
        series[k]["by_horizon"]["14-55"] = long_bt["series"][k]["by_horizon"]["14-55"]

    # Hourly: every till hour pooled, per channel (only the channels shown hourly, and all).
    hk = {k: v for k, v in hourly_act.items() if k[0] == "orders"}

    def hourly_cache(origin, issued, kt):
        p = rp.predictions.get(origin)
        if p is None:
            return {}
        out = defaultdict(dict)
        for (m, ch), by_t in p.hourly.items():
            if m != "orders":
                continue
            for t, hours in by_t.items():
                for th, trip in hours:
                    out[(m, ch, th.hour)][t] = trip
        return {k: v for k, v in out.items() if k in hk}

    hbt = rolling_backtest(hk, hourly_cache, issue_day, cutoff, horizon_buckets=SCORE_BUCKETS)
    hourly = {}
    for ch in ["all", *hourly_channels(prep)]:
        summaries = [s for k, s in hbt["series"].items() if k[1] == ch and s["n"]]
        if summaries:
            hourly[ch] = pooled(summaries)

    # Special days, on the same forecasts.
    special = {}
    for name, days in special_days(prep).items():
        sub = {k: {d: v for d, v in actuals[k].items() if d in days} for k in (("orders", "all"),) if k in actuals}
        sub = {k: v for k, v in sub.items() if v}
        if sub:
            s = rolling_backtest(sub, from_cache, issue_day, cutoff, horizon_buckets=SCORE_BUCKETS)["series"]
            special[name] = {f"{m}/{c}": _brief(v) for (m, c), v in s.items() if v["n"]}

    # Benchmarks on the same targets.
    bench = benchmarks(actuals, keys, issue_day, cutoff)
    return {"window": bt["window"], "series": series, "hourly": hourly, "special_days": special, "benchmarks": bench}


def benchmarks(actuals: dict, keys: list, issue_day: dt.date, cutoff: int) -> dict:
    ets = {k: ETS(actuals[k]) for k in keys}
    out = {}
    for name in ("last_week", "baseline", "ets"):
        def predict_origin(origin, issued, kt, name=name):
            res = {}
            for k in keys:
                s = actuals[k]
                by_t = {}
                for h in range(HORIZON_DAYS):
                    t = origin + dt.timedelta(days=h)
                    # Neither reads anything after kt (they only look back from it), so no copy is needed.
                    if name == "last_week":
                        p = last_week(s, t, kt)
                    elif name == "baseline":
                        p = baseline(s, t, kt)
                    else:
                        p = ets[k].predict(t, kt)
                    if p is not None:
                        by_t[t] = p
                res[k] = by_t
            return res

        bt = rolling_backtest({k: actuals[k] for k in keys}, predict_origin, issue_day, cutoff, horizon_buckets=SCORE_BUCKETS)
        out[name] = bt["series"]
    return out


def _brief(s: dict) -> dict:
    return {k: s[k] for k in ("wape", "coverage", "bias", "n", "days")}


def pass_bar(prep: Prepared, scored: dict, span_days: int) -> dict:
    """Checked per restaurant on the 12-week back-test: orders/all and every channel with at least 15% of orders."""
    checks = []
    series, base = scored["series"], scored["benchmarks"]["baseline"]
    checks.append({"check": "history", "need": "at least 8 weeks", "value": span_days, "ok": span_days >= 56})
    deciding = [("orders", "all")] + [("orders", c) for c in prep.channels if prep.shares.get(c, 0) >= MIN_CHANNEL_SHARE]
    for key in deciding:
        s, b = series.get(key), base.get(key)
        label = f"{key[0]}/{key[1]}"
        if not s or s["wape"] is None:
            checks.append({"check": f"{label} scored", "ok": False})
            continue
        checks.append({"check": f"{label} days scored", "need": f">= {MIN_SCORED_DAYS}", "value": s["days"], "ok": s["days"] >= MIN_SCORED_DAYS})
        bw = b["wape"] if b else None
        ok = bw is not None and s["wape"] <= (1 - PASS_IMPROVEMENT) * bw
        checks.append({"check": f"{label} WAPE vs baseline", "need": f"<= {round((1 - PASS_IMPROVEMENT) * bw, 4) if bw else None}",
                       "value": s["wape"], "baseline": bw, "improvement": round(1 - s["wape"] / bw, 4) if bw else None, "ok": ok})
        checks.append({"check": f"{label} 80% range coverage", "need": "0.75 to 0.85", "value": s["coverage"],
                       "ok": s["coverage"] is not None and COVERAGE_RANGE[0] <= s["coverage"] <= COVERAGE_RANGE[1]})
        checks.append({"check": f"{label} bias", "need": "under 5% either way", "value": s["bias"],
                       "ok": s["bias"] is not None and abs(s["bias"]) < MAX_ABS_BIAS})
    return {"passed": all(c["ok"] for c in checks), "checks": checks, "deciding_channels": [k[1] for k in deciding]}


def origins_for(issue_day: dt.date, cutoff: int, warmup: int = WARMUP_DAYS) -> tuple[list[dt.date], list[dt.date]]:
    """(warm-up origins, scored origins) for the 12-week replay."""
    w = window(issue_day, cutoff)
    scored = list(w.origins)
    first = scored[0] if scored else issue_day
    return [first - dt.timedelta(days=k) for k in range(warmup, 0, -1)], scored
