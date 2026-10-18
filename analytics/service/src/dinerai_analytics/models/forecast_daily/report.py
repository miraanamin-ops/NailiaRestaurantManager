"""The report: the long back-test across the history, and the data for the charts.

Long back-test (for the report only, never the pass bar): about 50 cut-offs spread
evenly from 10 weeks into the history to two weeks before the end. At each one the
model is fitted on what was known then (the choices re-made every 28 days, the
calibration from earlier cut-offs only) and forecasts 14 days; the benchmarks
forecast the same days. Every metric by channel and horizon, special days (Eid,
Ramadan, match days) separately, and every weight at every cut-off (so the charts
show how each weight moved).

Chart data: the 12-week replay's forecasts 1 and 7 days ahead against what
happened, with ranges, and today's 56-day forecast.
"""

from __future__ import annotations

import datetime as dt
import math
import time
from collections import defaultdict

import numpy as np

from ...backtest import _Acc
from ...cutoff import HORIZON_DAYS, issue_time_for, known_through
from .benchmarks import ETS, baseline, last_week
from .design import Config, Prepared
from .evaluate import SELECTION_EVERY_DAYS, actual_series, hourly_actuals, special_days
from .hourly import HourProfiles
from .predict import predict
from .ranges import BUCKETS, Calibration

LONG_CUTOFFS = 50
FIRST_AFTER_DAYS = 70
KEEP = ("wape", "coverage", "bias", "n", "days")


def long_backtest(prep: Prepared, cutoff: int, restaurant_id: str, profiles: HourProfiles, n_cutoffs: int = LONG_CUTOFFS,
                  select_fn=None) -> dict:
    from .evaluate import select

    select_fn = select_fn or select
    t0 = time.monotonic()
    actuals = actual_series(prep)
    days = sorted(prep.y["all"])
    first, last = days[0] + dt.timedelta(days=FIRST_AFTER_DAYS), days[-1] - dt.timedelta(days=HORIZON_DAYS - 1)
    step = max(1, (last - first).days // max(1, n_cutoffs - 1))
    origins = [first + dt.timedelta(days=step * i) for i in range(n_cutoffs) if first + dt.timedelta(days=step * i) <= last]
    keys = [k for k in actuals if k[0] in ("orders", "sales_pence", "covers")]
    special = special_days(prep)
    ets = {k: ETS(actuals[k]) for k in keys}

    acc = {name: defaultdict(lambda: defaultdict(_Acc)) for name in ("model", "baseline", "last_week", "ets")}
    spec_acc = {name: defaultdict(_Acc) for name in ("model", "baseline", "ets")}
    cal = Calibration()
    weights = []
    selection, made = None, None
    for o in origins:
        it = issue_time_for(o)
        kt = known_through(it, cutoff)
        if prep.history_span(kt) < 56:
            continue
        if made is None or (o - made).days >= SELECTION_EVERY_DAYS:
            selection, made = select_fn(prep, o, cutoff, restaurant_id), o
        cfg = Config.from_dict(selection["config"])
        targets = [o + dt.timedelta(days=h) for h in range(HORIZON_DAYS)]
        p = predict(prep, cfg, it, kt, targets, restaurant_id, profiles, cal, kt, None, hourly_days=0)
        for ch, ff in p.origin.fits.items():
            d = p.origin.designs[ch]
            weights.append({"cutoff": o.isoformat(), "channel": ch, "config": cfg.to_dict(),
                            "w": {c: [round(float(ff.beta[i]), 5), round(math.sqrt(max(ff.cov[i, i], 0.0)), 5)] for i, c in enumerate(d.columns)
                                  if d.active[i] or c.startswith(("level", "trend"))}})
        for k in keys:
            a = actuals[k]
            by_t = p.daily.get(k, {})
            for t in targets:
                v = a.get(t)
                if v is None:
                    continue
                h = (t - o).days
                bucket = next(n for n, lo, hi in BUCKETS if lo <= h <= hi)
                preds = {"model": by_t.get(t), "baseline": baseline(a, t, kt), "last_week": last_week(a, t, kt), "ets": ets[k].predict(t, kt)}
                for name, pr in preds.items():
                    if pr is None:
                        continue
                    acc[name][k]["all"].add(t, v, pr)
                    acc[name][k][bucket].add(t, v, pr)
                    if k == ("orders", "all") and name in spec_acc:
                        for sname, sdays in special.items():
                            if t in sdays:
                                spec_acc[name][sname].add(t, v, pr)
        # This cut-off's errors calibrate the later ones (each used once its target is known).
        for (metric, ch), by_t in p.raw.items():
            a = actuals.get((metric, ch))
            if a:
                for t, (lo, li, hi) in by_t.items():
                    if a.get(t) is not None:
                        cal.add(metric, ch, (t - o).days, t, a[t], lo, li, hi)

    def table(name):
        return {f"{m}/{c}": {b: {k: s.summary()[k] for k in KEEP} for b, s in by.items()} for (m, c), by in sorted(acc[name].items())}

    return {
        "cutoffs": [o.isoformat() for o in origins],
        "every_days": step,
        "model": table("model"),
        "benchmarks": {n: table(n) for n in ("baseline", "last_week", "ets")},
        "special_days": {name: {s: {k: a.summary()[k] for k in KEEP} for s, a in by.items()} for name, by in spec_acc.items()},
        "weights": weights,
        "seconds": round(time.monotonic() - t0, 1),
    }


def weights_now(prep: Prepared, live) -> dict:
    """Today's fit: every weight per channel (estimate, sd, prior mean, prior sd, whether the data moved it), each
    channel's share, and each weekday's hours-open offset (so weekday effects can be read as effects on orders)."""
    out = {"channels": {}, "shares": {c: round(v, 4) for c, v in prep.shares.items()}, "weekday_offset": {}}
    out["weekday_centred"] = {}
    for ch, ff in live.origin.fits.items():
        d = live.origin.designs[ch]
        out["channels"][ch] = {c: [float(ff.beta[i]), math.sqrt(max(ff.cov[i, i], 0.0)),
                                   float(d.prior_mean[i]) if math.isfinite(d.prior_mean[i]) else None,
                                   float(d.prior_sd[i]) if math.isfinite(d.prior_sd[i]) else None, bool(d.active[i])]
                               for i, c in enumerate(d.columns)}
        # Each weekday against the average of the seven, with its sd from the full covariance (the weekday weights
        # move together with the level, so their own sds overstate the doubt about the differences).
        names = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
        wd = [d.columns.index(f"weekday_{n}") for n in names]
        sub = ff.cov[np.ix_(wd, wd)]
        centred = {}
        for k, n in enumerate(names):
            c = np.full(len(wd), -1 / 7)
            c[k] += 1
            centred[n] = [float(c @ ff.beta[wd]), math.sqrt(max(float(c @ sub @ c), 0.0))]
        out["weekday_centred"][ch] = centred
    days = defaultdict(list)
    for day, h in prep.hours.items():
        if h.hours_open > 0 and day in prep.y["all"]:
            days[day.weekday()].append(math.log(h.hours_open / prep.usual_hours))
    names = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    out["weekday_offset"] = {names[k]: sum(v) / len(v) for k, v in days.items() if v}
    # Which days each calendar and event factor was on (and how strongly), for comparing with known effects.
    out["factor_days"] = {f: {d.isoformat(): v for d, v in by.items() if v} for f, by in prep.static.items()}
    out["trend_origin"] = live.known_through.isoformat()
    return out


def chart_data(prep: Prepared, nightly, horizons=(1, 7)) -> dict:
    """Forecast vs actual from the 12-week replay (days `horizons` ahead), and today's forecast."""
    actuals = actual_series(prep)
    out = {"replay": {}, "live": {}, "hourly_example": {}}
    rp = nightly.replay
    for key in (("orders", "all"), *(("orders", c) for c in prep.channels), ("sales_pence", "all")):
        a = actuals.get(key, {})
        series = {}
        for h in horizons:
            pts = []
            for o, p in sorted(rp.predictions.items()):
                t = o + dt.timedelta(days=h)
                trip = p.daily.get(key, {}).get(t)
                if trip and t in a and t >= min(rp.predictions) + dt.timedelta(days=28):
                    pts.append([t.isoformat(), round(a[t], 2), *(round(x, 2) for x in trip)])
            series[str(h)] = pts
        out["replay"][f"{key[0]}/{key[1]}"] = series
        live = nightly.live.daily.get(key, {})
        out["live"][f"{key[0]}/{key[1]}"] = [[t.isoformat(), *(round(x, 2) for x in trip)] for t, trip in sorted(live.items())]
    # One recent day hour by hour (1 day ahead) against what happened.
    hourly_act = hourly_actuals(prep)
    last = max(rp.predictions) if rp.predictions else None
    if last:
        p = rp.predictions[last - dt.timedelta(days=1)] if last - dt.timedelta(days=1) in rp.predictions else rp.predictions[last]
        for t, hours in sorted(p.hourly.get(("orders", "all"), {}).items())[1:2]:
            act = {th.hour: hourly_act.get(("orders", "all", th.hour), {}).get(t) for th, _ in hours}
            out["hourly_example"] = {"day": t.isoformat(), "hours": [[th.hour, act[th.hour], *(round(x, 2) for x in trip)] for th, trip in hours]}
    return out
