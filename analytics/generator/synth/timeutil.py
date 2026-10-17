"""London days and hours. Timestamps are UTC; trading days and till hours are London."""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
UTC = dt.timezone.utc


def days(start: dt.date, end: dt.date):
    d = start
    while d <= end:
        yield d
        d += dt.timedelta(days=1)


def london(day: dt.date, hour: int = 0, minute: int = 0) -> dt.datetime:
    """A London wall-clock time on a calendar day, as an aware datetime (first one if it happens twice)."""
    return dt.datetime(day.year, day.month, day.day, hour, minute, tzinfo=LONDON, fold=0)


def trading_hour_start(day: dt.date, hour: int, cutoff_hour: int = 5) -> dt.datetime:
    """UTC start of till hour `hour` (0 to 23) on trading day `day`, as analytics.sales_hourly
    computes it: hours before the cut-off are on the next calendar date; the October hour
    that happens twice starts at its first occurrence."""
    cal = day + dt.timedelta(days=1) if hour < cutoff_hour else day
    return london(cal, hour).astimezone(UTC)


def iso(t: dt.datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def last_sunday(year: int, month: int) -> dt.date:
    d = dt.date(year, month + 1, 1) - dt.timedelta(days=1) if month < 12 else dt.date(year, 12, 31)
    return d - dt.timedelta(days=(d.isoweekday() % 7))
