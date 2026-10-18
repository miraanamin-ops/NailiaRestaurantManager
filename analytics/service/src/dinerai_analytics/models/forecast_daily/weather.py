"""Weather factors, the same definition whatever the source.

  temp_warm / temp_cold  degrees above / below the seasonal normal of the day's
                         mean temperature ((max + min) / 2)
  temp_hot               degrees of the day's maximum above 26 C
  rain_lunch / _dinner   mm of rain in the open hours between 11:00 and 15:00 /
                         17:00 and 22:00 (London), capped at 10 mm
  sunshine               sunshine hours minus the month's normal

Sources by day:
  history (training)    the archive (weather_daily, weather_hourly)
  forecast days 0 to 6  the forecast as issued: the latest one issued by the issue
                        time, never a later one; rain windows from the hourly
                        forecast when it covers the window, else the day's rain
                        spread evenly over 24 hours
  forecast day 7 on     the seasonal normal, built only from archive days known by
                        the cut-off (so warm/cold/hot/sunshine are 0 and rain is the
                        month's average share)

The mean temperature is used (not the open hours' temperature) because the issued
forecasts for days 2 to 7 only have the day's max and min.
"""

from __future__ import annotations

import bisect
import datetime as dt
import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from .hours import DayHours, _local, overlap_minutes

WEATHER_FACTORS = ("temp_warm", "temp_cold", "temp_hot", "rain_lunch", "rain_dinner", "sunshine")
HOT_ABOVE = 26.0
RAIN_CAP = 10.0
LUNCH = (11, 15)
DINNER = (17, 22)
ISSUED_DAYS = 6  # forecasts as issued for days 0 to 6
# A London climatology the normal is pulled towards while the archive is short (about 30 days' worth).
CLIMATE_MEAN, CLIMATE_AMP, CLIMATE_PEAK_DOY = 11.5, 7.0, 200
CLIMATE_WEIGHT_DAYS = 30
DEFAULT_RAIN_MM = 1.8


@dataclass
class Normals:
    temp_coef: np.ndarray  # mean + cos + sin of the year
    sunshine_by_month: dict[int, float]
    rain_by_month: dict[int, float]

    def temp(self, d: dt.date) -> float:
        a = 2 * math.pi * d.timetuple().tm_yday / 365.25
        return float(self.temp_coef @ np.array([1.0, math.cos(a), math.sin(a)]))

    def sunshine(self, d: dt.date) -> float | None:
        return self.sunshine_by_month.get(d.month)

    def rain(self, d: dt.date) -> float:
        return self.rain_by_month.get(d.month, DEFAULT_RAIN_MM)


def normals(archive: list[dict], through: dt.date) -> Normals:
    """Seasonal normals from archive days up to `through` (a ridge fit towards the climatology)."""
    rows = [r for r in archive if r["day"] <= through and r.get("temp_max") is not None and r.get("temp_min") is not None]
    a0 = 2 * math.pi * CLIMATE_PEAK_DOY / 365.25
    prior = np.array([CLIMATE_MEAN, CLIMATE_AMP * math.cos(a0), CLIMATE_AMP * math.sin(a0)])
    xtx = np.eye(3) * CLIMATE_WEIGHT_DAYS
    xty = xtx @ prior
    for r in rows:
        a = 2 * math.pi * r["day"].timetuple().tm_yday / 365.25
        x = np.array([1.0, math.cos(a), math.sin(a)])
        xtx += np.outer(x, x)
        xty += x * (float(r["temp_max"]) + float(r["temp_min"])) / 2
    sun, rain = defaultdict(list), defaultdict(list)
    for r in archive:
        if r["day"] > through:
            continue
        if r.get("sunshine_hours") is not None:
            sun[r["day"].month].append(float(r["sunshine_hours"]))
        if r.get("rain_mm") is not None:
            rain[r["day"].month].append(float(r["rain_mm"]))
    return Normals(np.linalg.solve(xtx, xty), {m: sum(v) / len(v) for m, v in sun.items() if len(v) >= 10},
                   {m: sum(v) / len(v) for m, v in rain.items() if len(v) >= 10})


def _row(temp_mean: float | None, temp_max: float | None, sunshine: float | None, rain_l: float, rain_d: float,
         normal: Normals, d: dt.date) -> dict[str, float]:
    out = {"rain_lunch": min(rain_l, RAIN_CAP), "rain_dinner": min(rain_d, RAIN_CAP)}
    if temp_mean is not None:
        dev = temp_mean - normal.temp(d)
        out["temp_warm"], out["temp_cold"] = max(dev, 0.0), max(-dev, 0.0)
    if temp_max is not None:
        out["temp_hot"] = max(temp_max - HOT_ABOVE, 0.0)
    sun_normal = normal.sunshine(d)
    if sunshine is not None and sun_normal is not None:
        out["sunshine"] = sunshine - sun_normal
    return out


def _window_rain(d: dt.date, hours: DayHours, hourly: dict[dt.datetime, float], window: tuple[int, int]) -> float | None:
    """mm in the open part of the window from hourly values; None if an open hour has no value."""
    total = 0.0
    t, end = _local(d, window[0] * 60), _local(d, window[1] * 60)
    while t < end:
        open_m = overlap_minutes(hours.intervals, t, t + dt.timedelta(hours=1))
        if open_m > 0:
            v = hourly.get(t)
            if v is None:
                return None
            total += v * open_m / 60
        t += dt.timedelta(hours=1)
    return total


def _spread_rain(d: dt.date, hours: DayHours, daily_mm: float, window: tuple[int, int]) -> float:
    open_m = overlap_minutes(hours.intervals, _local(d, window[0] * 60), _local(d, window[1] * 60))
    return daily_mm * open_m / (24 * 60)


class Weather:
    """The weather data of one restaurant, indexed for fast look-ups."""

    def __init__(self, daily: list[dict], hourly: list[dict], forecasts: list[dict]):
        self.daily = {r["day"]: r for r in daily}
        self.archive = sorted(daily, key=lambda r: r["day"])
        self.hourly_rain = {r["hour_start"]: float(r["rain_mm"]) for r in hourly if r.get("rain_mm") is not None}
        # Forecasts: per target day (daily) and per hour (hourly), each a list sorted by issued_at.
        self.f_daily: dict[dt.date, list[tuple[dt.datetime, dict]]] = defaultdict(list)
        self.f_hourly: dict[dt.datetime, list[tuple[dt.datetime, float]]] = defaultdict(list)
        for r in forecasts:
            if r.get("hour_start") is None:
                if r.get("target_day") is not None:
                    self.f_daily[r["target_day"]].append((r["issued_at"], r))
            elif r.get("rain_mm") is not None:
                self.f_hourly[r["hour_start"]].append((r["issued_at"], float(r["rain_mm"])))
        for v in self.f_daily.values():
            v.sort(key=lambda x: x[0])
        for v in self.f_hourly.values():
            v.sort(key=lambda x: x[0])
        self._f_daily_issued = {k: [x[0] for x in v] for k, v in self.f_daily.items()}
        self._f_hourly_issued = {k: [x[0] for x in v] for k, v in self.f_hourly.items()}

    def normals(self, through: dt.date) -> Normals:
        return normals(self.archive, through)

    def raw_actual(self, d: dt.date, hours: DayHours) -> tuple[float | None, float | None, float | None, float, float] | None:
        """The archive's (mean temperature, max temperature, sunshine hours, lunch rain, dinner rain) for a day."""
        r = self.daily.get(d)
        if r is None:
            return None
        tmax = float(r["temp_max"]) if r.get("temp_max") is not None else None
        tmean = (tmax + float(r["temp_min"])) / 2 if tmax is not None and r.get("temp_min") is not None else None
        daily_rain = float(r["rain_mm"]) if r.get("rain_mm") is not None else 0.0
        rl = _window_rain(d, hours, self.hourly_rain, LUNCH)
        rd = _window_rain(d, hours, self.hourly_rain, DINNER)
        rl = _spread_rain(d, hours, daily_rain, LUNCH) if rl is None else rl
        rd = _spread_rain(d, hours, daily_rain, DINNER) if rd is None else rd
        sun = float(r["sunshine_hours"]) if r.get("sunshine_hours") is not None else None
        return tmean, tmax, sun, rl, rd

    def actual(self, d: dt.date, hours: DayHours, normal: Normals) -> dict[str, float]:
        raw = self.raw_actual(d, hours)
        if raw is None:
            return {}
        tmean, tmax, sun, rl, rd = raw
        return _row(tmean, tmax, sun, rl, rd, normal, d)

    def issued_daily(self, d: dt.date, issue_time: dt.datetime) -> dict | None:
        """The latest daily forecast for d issued by issue_time."""
        issued = self._f_daily_issued.get(d)
        if not issued:
            return None
        i = bisect.bisect_right(issued, issue_time)
        return self.f_daily[d][i - 1][1] if i else None

    def issued_hourly_rain(self, hour_start: dt.datetime, issue_time: dt.datetime) -> float | None:
        issued = self._f_hourly_issued.get(hour_start)
        if not issued:
            return None
        i = bisect.bisect_right(issued, issue_time)
        return self.f_hourly[hour_start][i - 1][1] if i else None

    def forecast(self, d: dt.date, horizon: int, hours: DayHours, normal: Normals, issue_time: dt.datetime) -> tuple[dict[str, float], str]:
        """The factors for a forecast day, and which source they came from."""
        f = self.issued_daily(d, issue_time) if horizon <= ISSUED_DAYS else None
        if f is None:
            rain = normal.rain(d)
            return _row(None, None, None, _spread_rain(d, hours, rain, LUNCH), _spread_rain(d, hours, rain, DINNER), normal, d), "normal"
        tmax = float(f["temp_max"]) if f.get("temp_max") is not None else None
        tmin = float(f["temp_min"]) if f.get("temp_min") is not None else None
        daily_rain = float(f["rain_mm"]) if f.get("rain_mm") is not None else normal.rain(d)
        hourly = {}
        for w in (LUNCH, DINNER):
            t, end = _local(d, w[0] * 60), _local(d, w[1] * 60)
            while t < end:
                v = self.issued_hourly_rain(t, issue_time)
                if v is not None:
                    hourly[t] = v
                t += dt.timedelta(hours=1)
        rl = _window_rain(d, hours, hourly, LUNCH)
        rd = _window_rain(d, hours, hourly, DINNER)
        source = "issued_hourly" if rl is not None and rd is not None else "issued_daily"
        rl = _spread_rain(d, hours, daily_rain, LUNCH) if rl is None else rl
        rd = _spread_rain(d, hours, daily_rain, DINNER) if rd is None else rd
        tmean = (tmax + tmin) / 2 if tmax is not None and tmin is not None else None
        sun = float(f["sunshine_hours"]) if f.get("sunshine_hours") is not None else None
        return _row(tmean, tmax, sun, rl, rd, normal, d), source
