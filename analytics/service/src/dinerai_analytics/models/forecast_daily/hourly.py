"""The hour profile: each hour's share of a day's orders, per channel and day type.

Day types, first match wins: Eid, Ramadan, bank holiday, match day (a relevant
match while open), then Friday, Saturday, Sunday or weekday.

Slots: hours are matched between days by a slot, not always the clock hour:
  Ramadan  hours counted from that day's maghrib (iftar), so the iftar surge lines
           up across a month in which maghrib moves by over an hour
  Friday   the Jummah window (dhuhr to dhuhr + 3 hours) counted from that day's
           dhuhr; the other hours by the clock
  others   the till's clock hour
then mapped back onto each forecast day's own clock hours.

Estimate (as of the last known day): the last 8 days of the same type, shrunk
towards that type's last 52 weeks with weight n / (n + 4); a special type (Eid,
Ramadan, bank holiday, match day) with few days is itself shrunk towards its
weekday's profile the same way. Lightly smoothed across neighbouring open hours.

Adding up: hourly likely values are the day's likely value times the shares,
rounded to 2 decimals with the remainder on the busiest hour, so they sum to the
day exactly. Ranges: each daily draw split by a Dirichlet-multinomial.
"""

from __future__ import annotations

import bisect
import datetime as dt
import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from .hours import TillHour

SHRINK = 4.0
RECENT_DAYS = 8
LONG_WEEKS = 52
SMOOTH = (0.15, 0.70, 0.15)
DIRICHLET_ALPHA = 50.0
JUMMAH_HOURS = 3
SPECIAL = ("eid", "ramadan", "bank_holiday", "match")
TYPES = (*SPECIAL, "fri", "sat", "sun", "weekday")
# Slots per scheme: 24 clock hours, plus 3 Jummah bins (Friday), or 25 bins around maghrib (-12 to +12 hours).
N_CLOCK = 24
SCHEMES = {"clock": N_CLOCK, "jummah": N_CLOCK + JUMMAH_HOURS, "maghrib": 25}


def weekday_class(d: dt.date) -> str:
    return {4: "fri", 5: "sat", 6: "sun"}.get(d.weekday(), "weekday")


def day_type(d: dt.date, static: dict[str, dict[dt.date, float]]) -> str:
    def on(*names):
        return any(static.get(n, {}).get(d) for n in names)

    if on("eid_fitr_d1", "eid_fitr_d2", "eid_fitr_d3", "eid_adha_d1", "eid_adha_d2", "eid_adha_d3"):
        return "eid"
    if on("ramadan_1_10", "ramadan_11_20", "ramadan_last10"):
        return "ramadan"
    if on("bank_holiday"):
        return "bank_holiday"
    if on("football_during", "football_after", "cricket_during", "cricket_after"):
        return "match"
    return weekday_class(d)


def scheme_for(kind: str) -> str:
    return "maghrib" if kind == "ramadan" else "jummah" if kind == "fri" else "clock"


def slot(th: TillHour, scheme: str, prayer: dict | None) -> int | None:
    """The slot index of a till hour (its middle) under a scheme; None if it can't be placed."""
    mid = th.start + dt.timedelta(minutes=30)
    if scheme == "maghrib":
        if not prayer or not prayer.get("maghrib"):
            return None
        b = math.floor((mid - prayer["maghrib"]).total_seconds() / 3600)
        return b + 12 if -12 <= b <= 12 else None
    if scheme == "jummah" and prayer and prayer.get("dhuhr"):
        off = (mid - prayer["dhuhr"]).total_seconds() / 3600
        if 0 <= off < JUMMAH_HOURS:
            return N_CLOCK + int(off)
    return th.hour


@dataclass
class _Series:
    days: list[dt.date]
    cum: np.ndarray  # (len(days) + 1, slots) running totals


class HourProfiles:
    """Hourly counts of each channel ('all' too) on usable days, indexed for quick profile look-ups."""

    def __init__(self, hours_by_day: dict, static: dict, prayer: dict[dt.date, dict], counts: dict[str, dict[dt.date, dict[int, float]]],
                 usable: set[dt.date]):
        self.hours = hours_by_day
        self.static = static
        self.prayer = prayer
        self.types = {d: day_type(d, static) for d in hours_by_day}
        self._series: dict[tuple[str, str, str], _Series] = {}
        self._by_label = {d: {th.hour: th for th in h.till} for d, h in hours_by_day.items()}
        self.counts = counts
        self.usable = usable

    def _vector(self, d: dt.date, channel: str, scheme: str) -> np.ndarray | None:
        by_hour = self.counts.get(channel, {}).get(d)
        if not by_hour:
            return None
        v = np.zeros(SCHEMES[scheme])
        labels = self._by_label.get(d, {})
        for hour, n in by_hour.items():
            th = labels.get(hour)
            if th is None:
                continue
            s = slot(th, scheme, self.prayer.get(d))
            if s is None:
                s = th.hour if scheme != "maghrib" else None
            if s is not None and s < len(v):
                v[s] += n
        return v if v.sum() > 0 else None

    def _get(self, kind: str, channel: str, scheme: str) -> _Series:
        key = (kind, channel, scheme)
        if key not in self._series:
            days, rows = [], []
            for d in sorted(self.counts.get(channel, {})):
                # A weekday class (fri, sat...) only takes plain days of that class, not Eid or bank holidays.
                if d not in self.usable or self.types.get(d) != kind:
                    continue
                v = self._vector(d, channel, scheme)
                if v is not None:
                    days.append(d)
                    rows.append(v)
            slots = SCHEMES[scheme]
            cum = np.zeros((len(days) + 1, slots))
            if rows:
                cum[1:] = np.cumsum(np.array(rows), axis=0)
            self._series[key] = _Series(days, cum)
        return self._series[key]

    def _window(self, s: _Series, kt: dt.date) -> tuple[np.ndarray, int, np.ndarray, int]:
        i = bisect.bisect_right(s.days, kt)
        r0 = max(0, i - RECENT_DAYS)
        j = bisect.bisect_left(s.days, kt - dt.timedelta(weeks=LONG_WEEKS))
        return s.cum[i] - s.cum[r0], i - r0, s.cum[i] - s.cum[j], i - j

    def profile(self, d: dt.date, channel: str, kt: dt.date) -> tuple[np.ndarray, str, str]:
        """Slot shares for day d (as of kt), the day type and the scheme."""
        kind = self.types.get(d) or weekday_class(d)
        scheme = scheme_for(kind)
        recent, n_r, long, n_l = self._window(self._get(kind, channel, scheme), kt)
        long_p = _norm(long)
        if kind in SPECIAL:
            _, _, parent, _ = self._window(self._get(weekday_class(d), channel, scheme), kt)
            long_p = (n_l / (n_l + SHRINK)) * long_p + (SHRINK / (n_l + SHRINK)) * _norm(parent)
        p = (n_r / (n_r + SHRINK)) * _norm(recent) + (SHRINK / (n_r + SHRINK)) * long_p
        return p, kind, scheme

    def shares(self, d: dt.date, channel: str, kt: dt.date) -> tuple[list[TillHour], np.ndarray, str]:
        """The open till hours of day d and each one's share of the day (summing to 1), and the day type."""
        h = self.hours.get(d)
        open_hours = [th for th in (h.till if h else []) if th.open_minutes > 0]
        if not open_hours:
            return [], np.zeros(0), self.types.get(d, weekday_class(d))
        p, kind, scheme = self.profile(d, channel, kt)
        prayer = self.prayer.get(d)
        w = np.zeros(len(open_hours))
        for i, th in enumerate(open_hours):
            s = slot(th, scheme, prayer)
            if s is None:
                s = th.hour if scheme != "maghrib" else None
            w[i] = p[s] if s is not None and s < len(p) else 0.0
        frac = np.array([th.open_minutes / 60 for th in open_hours])
        if w.sum() <= 0:
            w = frac.copy()
        else:
            w = np.where(w > 0, w, 1e-3 * w.max() * frac)
        if len(w) >= 3:
            a, b, c = SMOOTH
            padded = np.concatenate([[w[0]], w, [w[-1]]])
            w = a * padded[:-2] + b * padded[1:-1] + c * padded[2:]
        return open_hours, w / w.sum(), kind


def _norm(v: np.ndarray) -> np.ndarray:
    s = v.sum()
    return v / s if s > 0 else v


def split_exact(total: float, shares: np.ndarray, decimals: int = 2) -> np.ndarray:
    """total x shares, rounded, with the rounding remainder on the largest share, so it sums to total exactly."""
    if len(shares) == 0:
        return np.zeros(0)
    scale = 10**decimals
    t = round(total * scale)
    parts = np.floor(np.asarray(shares) * t + 1e-9).astype(np.int64)
    parts[int(np.argmax(shares))] += t - int(parts.sum())
    return parts / scale


def split_draws(daily: np.ndarray, shares: np.ndarray, rng: np.random.Generator, alpha: float = DIRICHLET_ALPHA) -> np.ndarray:
    """(S,) daily counts -> (S, H) hourly counts: Dirichlet-multinomial around the shares."""
    if len(shares) == 0:
        return np.zeros((len(daily), 0))
    a = np.maximum(shares, 1e-6) * alpha
    p = rng.dirichlet(a, size=len(daily))
    n = np.maximum(np.round(daily), 0).astype(np.int64)
    return np.array([rng.multinomial(k, pi) for k, pi in zip(n, p, strict=True)], dtype=float)


def hourly_counts(rows: list[dict], key: str) -> dict[dt.date, dict[int, float]]:
    """{day: {till hour: count}} from sales_hourly (key 'transactions') or channel hour rows (key 'orders')."""
    out: dict[dt.date, dict[int, float]] = defaultdict(dict)
    for r in rows:
        v = r.get(key)
        if v is not None and r.get("hour") is not None:
            out[r["day"]][int(r["hour"])] = out[r["day"]].get(int(r["hour"]), 0.0) + float(v)
    return out
