"""When a forecast is issued, and which trading days it may use.

Every forecast model, and every back-test of one, uses these rules, so their
numbers are comparable:

- The nightly run issues forecasts at 03:05 UK time (the dispatcher's hourly run
  at 5 past 3; src/lib/queue/config.ts NIGHTLY_MODELS_HOUR). A back-test pretends
  to issue at 03:05 on each past day.
- A trading day may be used once it has ENDED by the issue time: a trading day
  ends the next calendar day at the restaurant's trading-day cut-off (05:00 by
  default, migration 038), because a late takeaway's 00:30 sales belong to the
  day before. So at 03:05 on the 18th, the 17th (ending 05:00 on the 18th) isn't
  known yet and the latest usable day is the 16th.
- Forecasts cover the issue day and the 13 days after it (14 days).
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
UTC = dt.timezone.utc
NIGHTLY_ISSUE = dt.time(3, 5)
HORIZON_DAYS = 14


def london_day(t: dt.datetime) -> dt.date:
    return t.astimezone(LONDON).date()


def issue_time_for(day: dt.date) -> dt.datetime:
    """03:05 London time on this day, in UTC."""
    return dt.datetime.combine(day, NIGHTLY_ISSUE, tzinfo=LONDON).astimezone(UTC)


def trading_day_end(day: dt.date, cutoff_hour: int) -> dt.datetime:
    """When trading day `day` ends: the next calendar day at the cut-off hour, London time, in UTC."""
    return dt.datetime.combine(day + dt.timedelta(days=1), dt.time(cutoff_hour), tzinfo=LONDON).astimezone(UTC)


def known_through(issue_time: dt.datetime, cutoff_hour: int) -> dt.date:
    """The last trading day that had ended by issue_time."""
    day = london_day(issue_time)
    while trading_day_end(day, cutoff_hour) > issue_time:
        day -= dt.timedelta(days=1)
    return day


def forecast_days(issue_day: dt.date, horizon: int = HORIZON_DAYS) -> list[dt.date]:
    return [issue_day + dt.timedelta(days=h) for h in range(horizon)]
