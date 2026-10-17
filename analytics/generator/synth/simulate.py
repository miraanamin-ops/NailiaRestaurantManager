"""Runs one dataset end to end in memory: outside data, demand, sales, deals, staff, costs."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np

from . import deals as deals_mod
from .datasets import PLACES, window
from .demand import Demand
from .menu import Menu
from .outside import calendar as cal
from .outside import weather as wx
from .sales import simulate_day

EXPORT_DAYS = 92  # receipt-level detail kept for the last ~3 months (POS exports)


@dataclass
class Sim:
    cfg: dict
    seed: int
    start: dt.date
    end: dt.date
    events: list
    prayer: dict
    wh: object
    wd: object
    fc: object
    fcd: object
    sun_normal: dict
    menu: Menu
    campaigns: list
    days: list           # demand info per day
    results: list        # DayResult per day
    export_from: dt.date


def run(cfg: dict, seed: int, end: dt.date) -> Sim:
    start, end = window(end)
    lat, lon = PLACES[cfg["place"]]
    events = cal.all_events(start, end, cfg["council"]["code"])
    prayer = cal.prayer_times(lat, lon, start, end)
    wh = wx.hourly(cfg["place"])
    wd = wx.daily(wh)
    fc = wx.forecasts(cfg["place"])
    fcd = wx.forecast_daily(fc)
    sun_normal = wx.sunshine_normal(wd.loc[[d for d in wd.index if start <= d <= end]])
    menu = Menu(cfg, start)
    dem = Demand(cfg, start, end, events, prayer, wh, wd, sun_normal, menu, np.random.default_rng([seed, cfg["seed_offset"], 1]))
    dem.lat, dem.lon = lat, lon
    ramadan = {d for e in events if e["kind"] == "ramadan" for d in cal.event_days(e)}
    camps = deals_mod.campaigns(cfg, start, end, {d for d in ramadan if start <= d <= end})
    export_from = end - dt.timedelta(days=EXPORT_DAYS - 1)
    infos, results = [], []
    d = start
    while d <= end:
        info = dem.day(d)
        infos.append(info)
        results.append(simulate_day(info, menu, cfg, camps, seed, keep_receipts=d >= export_from))
        d += dt.timedelta(days=1)
    return Sim(cfg, seed, start, end, events, prayer, wh, wd, fc, fcd, sun_normal, menu, camps, infos, results, export_from)
