"""Opening hours, the hours-open offset, and till hours on the real clock.

A trading day runs from its cut-off hour (05:00 by default) to the same hour the
next calendar day, London time. Till hours before the cut-off belong to the
trading day before (a takeaway's 00:30 sale is the evening before), as in the
database's trading_hour_date.

Hours open are measured in real elapsed time, so the October clock-change night
really is an hour longer for a place open past 01:00, and the March one an hour
shorter. Closures (restaurant_events of type closure or refit, or a partial
closure) take their overlap off.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from ...cutoff import LONDON, UTC

WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
CLOSURE_TYPES = ("closure", "refit", "partial_closure")
_TIME = re.compile(r"(\d{1,2})[:.](\d{2})")

Interval = tuple[dt.datetime, dt.datetime]  # UTC, end exclusive


def parse_ranges(text: str | None) -> list[tuple[int, int]]:
    """'12:00 – 23:00' or '16:00–02:00, 17:00-22:00' or 'Closed' -> [(open, close)] in minutes from the
    start of the calendar day; a close at or before the open is the next day (+1440)."""
    if not text or re.search(r"closed", text, re.I):
        return []
    out = []
    for part in re.split(r"[,;]", text):
        times = _TIME.findall(part)
        if len(times) < 2:
            continue
        (h1, m1), (h2, m2) = times[0], times[1]
        a, b = int(h1) * 60 + int(m1), int(h2) * 60 + int(m2)
        if b <= a:
            b += 1440
        out.append((a, b))
    return out


def _local(day: dt.date, minutes: int) -> dt.datetime:
    """London wall-clock time `minutes` after the start of `day`, in UTC. In the October repeated hour the
    first one; a time skipped in March moves forward with the clock."""
    d = day + dt.timedelta(days=minutes // 1440)
    m = minutes % 1440
    local = dt.datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=LONDON)
    return local.astimezone(UTC)


def day_text(day: dt.date, opening_hours: dict | None, special_hours: dict | None) -> str | None:
    """The hours that apply on a day: special hours for that date ('usual' = the weekday's), else the weekday's."""
    special = (special_hours or {}).get(day.isoformat())
    if isinstance(special, dict):
        hours = special.get("hours")
        if hours and hours.strip().lower() != "usual":
            return hours
    elif isinstance(special, str) and special.strip().lower() != "usual":
        return special
    return (opening_hours or {}).get(WEEKDAY_NAMES[day.weekday()])


def open_intervals(day: dt.date, opening_hours: dict | None, special_hours: dict | None) -> list[Interval]:
    """The day's opening times as real (UTC) intervals."""
    return [(_local(day, a), _local(day, b)) for a, b in parse_ranges(day_text(day, opening_hours, special_hours))]


def subtract(intervals: list[Interval], cuts: list[Interval]) -> list[Interval]:
    out = list(intervals)
    for c0, c1 in cuts:
        nxt = []
        for a, b in out:
            if c1 <= a or c0 >= b:
                nxt.append((a, b))
                continue
            if a < c0:
                nxt.append((a, c0))
            if c1 < b:
                nxt.append((c1, b))
        out = nxt
    return out


def overlap_minutes(intervals: list[Interval], start: dt.datetime, end: dt.datetime) -> float:
    return sum(max(0.0, (min(b, end) - max(a, start)).total_seconds() / 60) for a, b in intervals)


def closure_cuts(events: list[dict]) -> list[Interval]:
    """Closed periods from restaurant_events (an open-ended one lasts a day)."""
    cuts = []
    for e in events:
        if e["type"] in CLOSURE_TYPES and e.get("starts_at"):
            start = e["starts_at"]
            cuts.append((start, e.get("ends_at") or start + dt.timedelta(days=1)))
    return cuts


@dataclass(frozen=True)
class TillHour:
    hour: int  # the till's London hour label (0 to 23)
    start: dt.datetime  # UTC start of the (first) real hour
    minutes: int  # real minutes in it (120 for the October repeated hour, 60 otherwise)
    open_minutes: float  # minutes of it the restaurant is open
    calendar_day: dt.date  # the London date it happens on


def trading_day_bounds(day: dt.date, cutoff_hour: int) -> tuple[dt.datetime, dt.datetime]:
    return _local(day, cutoff_hour * 60), _local(day + dt.timedelta(days=1), cutoff_hour * 60)


def till_hours(day: dt.date, intervals: list[Interval], cutoff_hour: int) -> list[TillHour]:
    """Every till hour of the trading day that really happens, with its open minutes. In October the
    repeated 01:00 is one till hour of 120 minutes; in March the skipped hour isn't there."""
    start, end = trading_day_bounds(day, cutoff_hour)
    by_label: dict[int, list[dt.datetime]] = {}
    t = start
    while t < end:
        by_label.setdefault(t.astimezone(LONDON).hour, []).append(t)
        t += dt.timedelta(hours=1)
    out = []
    for label, starts in by_label.items():
        first = min(starts)
        open_m = sum(overlap_minutes(intervals, s, s + dt.timedelta(hours=1)) for s in starts)
        out.append(TillHour(label, first, 60 * len(starts), open_m, first.astimezone(LONDON).date()))
    return sorted(out, key=lambda h: h.start)


def hour_trading_day(calendar_day: dt.date, hour: int, cutoff_hour: int) -> dt.date:
    """The trading day a London clock hour belongs to."""
    return calendar_day - dt.timedelta(days=1) if hour < cutoff_hour else calendar_day


@dataclass(frozen=True)
class DayHours:
    intervals: list[Interval]  # after closures
    hours_open: float  # real elapsed hours open
    till: list[TillHour]


def has_opening_hours(restaurant: dict) -> bool:
    """Whether any weekday's opening hours are set (else every day counts as open all day)."""
    return any(parse_ranges(v) for v in (restaurant.get("opening_hours") or {}).values())


def day_hours(day: dt.date, restaurant: dict, closures: list[Interval], cutoff_hour: int, all_day: bool = False) -> DayHours:
    """all_day: no opening hours are set, so the whole trading day counts as open."""
    if all_day:
        ivs = subtract([trading_day_bounds(day, cutoff_hour)], closures)
    else:
        ivs = subtract(open_intervals(day, restaurant.get("opening_hours"), restaurant.get("special_hours")), closures)
    hours = sum((b - a).total_seconds() for a, b in ivs) / 3600
    return DayHours(ivs, hours, till_hours(day, ivs, cutoff_hour))


def window_minutes(day: dt.date, intervals: list[Interval], start_hour: int, end_hour: int) -> float:
    """Open minutes between two London clock times on the calendar day (e.g. lunch 11:00 to 15:00)."""
    return overlap_minutes(intervals, _local(day, start_hour * 60), _local(day, end_hour * 60))
