"""When a forecast is issued, and which trading days it may use.

Every forecast model, and every back-test of one, uses these rules, so their
numbers are comparable:

- The nightly run issues forecasts at 05:35 UK time (the app queues the jobs to
  start then; src/lib/queue/config.ts NIGHTLY_MODELS_AT). A back-test pretends to
  issue at 05:35 on each past day.
- A trading day may be used once it has ENDED by the issue time: a trading day
  ends the next calendar day at the restaurant's trading-day cut-off (05:00 by
  default, migration 038), because a late takeaway's 00:30 sales belong to the
  day before. 05:35 is after that cut-off, so at 05:35 on the 18th the 17th
  (which ended at 05:00) is known. A restaurant with a later cut-off (say 06:00)
  gets the day before that instead.
- Forecasts cover the issue day and the 13 days after it (14 days).
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
UTC = dt.timezone.utc
NIGHTLY_ISSUE = dt.time(5, 35)
HORIZON_DAYS = 14


def london_day(t: dt.datetime) -> dt.date:
    return t.astimezone(LONDON).date()


def issue_time_for(day: dt.date) -> dt.datetime:
    """05:35 London time on this day, in UTC."""
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
