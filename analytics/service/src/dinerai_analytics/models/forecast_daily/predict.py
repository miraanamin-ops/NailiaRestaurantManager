"""From one origin's fitted channels to every forecast series: orders per channel and in all,
sales (net), covers, daily and hourly, calibrated.

Adding up, always:
- orders/all likely = the sum of the channels' likely values (sum method), or the
  direct model's value with the channels scaled to it (direct method);
- each channel's hourly likely values sum to its daily value (split_exact), and the
  all-channel hourly values are the sums of the channels' hours (small channels
  included, though small channels' hours are never written), so they add up too;
- sales and covers hours sum to their days the same way.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np

from .derived import Spend, day_kind, daypart, spend_model
from .design import Config, Prepared
from .forecast import OriginForecast, contributions, forecast_origin, rng_for, top_drivers, warm_start
from .hourly import HourProfiles, split_draws, split_exact
from .hours import TillHour
from .ranges import Calibration, apply, quantiles

HOURLY_DAYS = 14
HOURLY_MIN_SHARE = 0.15  # a channel under 15% of orders gets no hourly rows

Key = tuple[str, str]  # (metric, channel)
Triple = tuple[float, float, float]


@dataclass
class Prediction:
    issue_day: dt.date
    known_through: dt.date
    targets: list[dt.date]
    daily: dict[Key, dict[dt.date, Triple]] = field(default_factory=dict)  # calibrated
    raw: dict[Key, dict[dt.date, Triple]] = field(default_factory=dict)  # before calibration (for the calibration records)
    hourly: dict[Key, dict[dt.date, list[tuple[TillHour, Triple]]]] = field(default_factory=dict)
    hourly_raw: dict[Key, dict[dt.date, list[tuple[TillHour, Triple]]]] = field(default_factory=dict)
    drivers: dict[str, dict[dt.date, list[tuple[str, float]]]] = field(default_factory=dict)
    origin: OriginForecast | None = None
    method: str = "sum"
    warm: dict = field(default_factory=dict)


def hourly_channels(prep: Prepared) -> list[str]:
    return [c for c in prep.channels if prep.shares.get(c, 0) >= HOURLY_MIN_SHARE]


def predict(prep: Prepared, cfg: Config, issue_time: dt.datetime, kt: dt.date, targets: list[dt.date], restaurant_id: str,
            profiles: HourProfiles, calib: Calibration | None = None, calib_through: dt.date | None = None,
            warm: dict | None = None, hourly_days: int = HOURLY_DAYS, with_drivers: bool = False, want_direct: bool = False) -> Prediction:
    from ...cutoff import london_day

    issue_day = london_day(issue_time)
    of = forecast_origin(prep, cfg, issue_time, kt, targets, restaurant_id, warm=warm, want_direct=want_direct)
    out = Prediction(issue_day, kt, targets, origin=of, method=of.all_method, warm=warm_start(of))
    channels = [c for c in prep.channels if c in of.draws]
    T = len(targets)
    rng = rng_for(restaurant_id, issue_day, "ranges")
    q_cache: dict[tuple[str, str, int], float] = {}

    def q(metric: str, channel: str, h: int) -> float:
        if calib is None:
            return 1.0
        k = (metric, channel, h)
        if k not in q_cache:
            q_cache[k] = calib.q(metric, channel, h, calib_through)
        return q_cache[k]

    horizon = [(t - issue_day).days for t in targets]

    # Daily orders: each channel, then the all total.
    likely: dict[str, np.ndarray] = {}
    qs: dict[str, np.ndarray] = {}
    draws = {c: of.draws[c] for c in channels}  # scaled to the direct model below, when that's the method
    for c in channels:
        qs[c] = quantiles(draws[c], rng)
        likely[c] = qs[c][1].copy()
    if of.all_method == "direct" or not channels:
        qa = quantiles(of.draws["all"], rng)
        all_likely = qa[1].copy()
        if channels:
            total = sum(likely[c] for c in channels)
            scale = np.divide(all_likely, total, out=np.ones(T), where=total > 0)
            for c in channels:
                draws[c] = draws[c] * scale[None, :]
                qs[c] = qs[c] * scale
                likely[c] = qs[c][1].copy()
    else:
        qa = quantiles(of.draws["sum"], rng)
    # Two decimals first, so the all total is exactly the channels' sum, and the hours add up to it.
    for c in channels:
        likely[c] = np.round(likely[c], 2)
    if channels:
        all_likely = np.round(sum(likely[c] for c in channels), 2)
    else:
        all_likely = np.round(all_likely, 2)
    qs["all"] = np.vstack([np.minimum(qa[0], all_likely), all_likely, np.maximum(qa[2], all_likely)])
    likely["all"] = all_likely
    open_ = np.array([prep.hours[t].hours_open > 0 for t in targets])
    for c in ["all", *channels]:
        raw, cal = {}, {}
        for i, t in enumerate(targets):
            if not open_[i]:
                raw[t] = cal[t] = (0.0, 0.0, 0.0)
                continue
            lo, li, hi = float(min(qs[c][0][i], likely[c][i])), float(likely[c][i]), float(max(qs[c][2][i], likely[c][i]))
            raw[t] = (lo, li, hi)
            cal[t] = apply(lo, li, hi, q("orders", c, horizon[i]))
        out.raw[("orders", c)], out.daily[("orders", c)] = raw, cal

    # Hour shares for every target (sales use them for the dayparts); hourly rows for the first 14 days.
    shares: dict[tuple[str, dt.date], tuple[list[TillHour], np.ndarray]] = {}
    for t in targets:
        for c in channels:
            hrs, s, _ = profiles.shares(t, c, kt)
            shares[(c, t)] = (hrs, s)
    # Hours only where there is hourly history to learn the profile from.
    with_hours = {c for c in channels if profiles.counts.get(c)}
    show = set(hourly_channels(prep)) & with_hours
    for i, t in enumerate(targets):
        if horizon[i] >= hourly_days or not open_[i] or not channels or with_hours != set(channels):
            continue
        hrs = shares[(channels[0], t)][0]
        if not hrs:
            continue
        total_likely = np.zeros(len(hrs))
        total_draws = np.zeros((draws[channels[0]].shape[0], len(hrs)))
        for c in channels:
            _, s = shares[(c, t)]
            li = split_exact(float(likely[c][i]), s)
            total_likely += li
            d = split_draws(draws[c][:, i], s, rng)
            total_draws += d
            if c in show:
                _hourly(out, ("orders", c), t, hrs, li, d, rng, q("orders_hourly", c, horizon[i]))
        _hourly(out, ("orders", "all"), t, hrs, np.round(total_likely, 2), total_draws, rng, q("orders_hourly", "all", horizon[i]))

    # Sales (net pence, all channels).
    price = prep.prices.series(sorted({*targets, *(kt - dt.timedelta(days=k) for k in range(56))}), issue_time, kt, prep.first_day)
    spend = spend_model(prep.data.daily, prep.data.channels, prep.data.channel_hours, kt, prep.cutoff_hour, price)
    _sales(out, prep, draws, spend, price, channels, likely, shares, targets, horizon, open_, hourly_days if with_hours == set(channels) else 0, rng, q)

    # Covers (dine-in, where recorded): the same values as covers/all.
    if "dine_in" in channels and spend.party:
        _covers(out, draws, spend, likely, shares, targets, horizon, open_, hourly_days, rng, q, "dine_in" in show)

    if with_drivers:
        _drivers(out, prep, of, channels, likely, targets, issue_time, kt)
    return out


def _hourly(out: Prediction, key: Key, t: dt.date, hrs, likely_h: np.ndarray, draws_h: np.ndarray, rng, qv: float) -> None:
    qh = quantiles(draws_h, rng)
    raw, cal = [], []
    for j, th in enumerate(hrs):
        li = float(likely_h[j])
        lo, hi = float(min(qh[0][j], li)), float(max(qh[2][j], li))
        raw.append((th, (lo, li, hi)))
        cal.append((th, apply(lo, li, hi, qv)))
    out.hourly_raw.setdefault(key, {})[t] = raw
    out.hourly.setdefault(key, {})[t] = cal


def _avg_spend(spend: Spend, c: str, hrs: list[TillHour], log_index: float, cutoff: int, kind: str) -> np.ndarray:
    return np.array([spend.spend(c, daypart(th.hour, cutoff), log_index, kind) or 0.0 for th in hrs]) if hrs else np.zeros(0)


def _sales(out, prep, draws, spend, price, channels, likely, shares, targets, horizon, open_, hourly_days, rng, q) -> None:
    if not channels and spend.all_per_order is None:
        return
    raw, cal = {}, {}
    for i, t in enumerate(targets):
        if not open_[i]:
            raw[t] = cal[t] = (0.0, 0.0, 0.0)
            continue
        li_total = 0.0
        draws_total = None
        per_hour = None
        hrs = shares[(channels[0], t)][0] if channels else []
        for c in channels:
            h, s = shares[(c, t)]
            sp = _avg_spend(spend, c, h, price.get(t, 0.0), prep.cutoff_hour, day_kind(t))
            avg = float(s @ sp) if len(s) else (spend.spend(c, "evening", price.get(t, 0.0), day_kind(t)) or 0.0)
            li_total += float(likely[c][i]) * avg
            d = draws[c][:, i] * avg
            draws_total = d if draws_total is None else draws_total + d
            if len(s):
                contrib = float(likely[c][i]) * s * sp
                per_hour = contrib if per_hour is None else per_hour + contrib
        if draws_total is None:
            continue
        qd = quantiles(draws_total[:, None], rng)[:, 0]
        lo, li, hi = float(min(qd[0], li_total)), round(li_total, 2), float(max(qd[2], li_total))
        raw[t] = (lo, li, hi)
        cal[t] = apply(lo, li, hi, q("sales_pence", "all", horizon[i]))
        if horizon[i] < hourly_days and per_hour is not None and per_hour.sum() > 0:
            sh = per_hour / per_hour.sum()
            li_h = split_exact(li, sh)
            d_h = draws_total[:, None] * sh[None, :]
            _hourly(out, ("sales_pence", "all"), t, hrs, li_h, d_h, rng, q("sales_hourly", "all", horizon[i]))
    out.raw[("sales_pence", "all")], out.daily[("sales_pence", "all")] = raw, cal


def _covers(out, draws, spend, likely, shares, targets, horizon, open_, hourly_days, rng, q, hourly: bool) -> None:
    raw, cal = {}, {}
    for i, t in enumerate(targets):
        if not open_[i]:
            raw[t] = cal[t] = (0.0, 0.0, 0.0)
            continue
        party = spend.party.get(day_kind(t)) or next(iter(spend.party.values()))
        li = round(float(likely["dine_in"][i]) * party, 2)
        qd = quantiles((draws["dine_in"][:, i] * party)[:, None], rng)[:, 0]
        lo, hi = float(min(qd[0], li)), float(max(qd[2], li))
        raw[t] = (lo, li, hi)
        cal[t] = apply(lo, li, hi, q("covers", "dine_in", horizon[i]))
        if hourly and horizon[i] < hourly_days:
            hrs, s = shares[("dine_in", t)]
            if len(s):
                _hourly(out, ("covers", "dine_in"), t, hrs, split_exact(li, s), (draws["dine_in"][:, i] * party)[:, None] * s[None, :], rng,
                        q("covers_hourly", "dine_in", horizon[i]))
    for ch in ("all", "dine_in"):
        out.raw[("covers", ch)], out.daily[("covers", ch)] = raw, cal
    if ("covers", "dine_in") in out.hourly:
        out.hourly[("covers", "all")] = out.hourly[("covers", "dine_in")]
        out.hourly_raw[("covers", "all")] = out.hourly_raw[("covers", "dine_in")]


def _drivers(out: Prediction, prep: Prepared, of: OriginForecast, channels, likely, targets, issue_time, kt) -> None:
    # Prices count as a driver against the index 12 weeks ago, so a recent price change shows.
    price_ref_day = kt - dt.timedelta(days=84)
    ref = prep.prices.series([price_ref_day], issue_time, kt, prep.first_day).get(price_ref_day, 0.0)
    for c in channels + (["all"] if "all" in of.fits else []):
        d, ff = of.designs[c], of.fits[c]
        contrib = contributions(d, ff, ref)
        out.drivers[c] = {t: top_drivers(contrib[i]) for i, t in enumerate(targets)}
    if "all" not in out.drivers and channels:
        # The all total from the channels: a factor's multiplier is total / total without it.
        per = {c: contributions(of.designs[c], of.fits[c]) for c in channels}
        res = {}
        for i, t in enumerate(targets):
            tot = sum(float(likely[c][i]) for c in channels)
            if tot <= 0:
                res[t] = []
                continue
            names = {f for c in channels for f in per[c][i] if f != "closed"}
            contrib = {}
            for f in names:
                without = sum(float(likely[c][i]) * np.exp(-per[c][i].get(f, 0.0)) for c in channels)
                if without > 0:
                    contrib[f] = float(np.log(tot / without))
            res[t] = top_drivers(contrib)
        out.drivers["all"] = res
