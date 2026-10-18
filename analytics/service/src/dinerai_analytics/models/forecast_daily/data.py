"""Reading everything the model uses, for one restaurant, through the run's ViewReader.

Sales and weather actuals are read up to the last known trading day (and the
archive weather only to the day before the issue day). Things known in advance
(the calendar, fixtures, opening hours, deals, prices) are read whole and
filtered by what was known at each issue time where they record it
(deals by sent time, prices by recorded_at, weather forecasts by issued_at).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from ...db import ViewReader

VIEWS = (
    "restaurants", "sales_daily", "sales_channels", "sales_hourly", "sales_items", "dish_prices", "deals", "restaurant_events",
    "weather_daily", "weather_hourly", "weather_forecasts", "calendar", "calendar_relevance", "football_fixtures",
    "restaurant_teams", "venues", "prayer_times", "model_runs", "model_coefficients",
)
# How far back the forecast reads. With a 26-week half-life, days older than this weigh under 2%.
HISTORY_DAYS = 3 * 365
# Weather forecasts as issued, read this far before the first back-test origin.
FORECAST_LOOKBACK_DAYS = 200


@dataclass
class Data:
    restaurant: dict
    daily: list[dict]
    channels: list[dict]  # daily rows (hour is null)
    channel_hours: list[dict]  # hourly rows
    hourly: list[dict]
    items: list[dict]
    prices: list[dict]
    deals: list[dict]
    events: list[dict]
    weather_daily: list[dict]
    weather_hourly: list[dict]
    weather_forecasts: list[dict]
    calendar: list[dict]
    relevance: list[dict]
    fixtures: list[dict]
    teams: list[str]
    venues: list[dict]
    prayer: list[dict]
    notes: list[str] = field(default_factory=list)


def load(reader: ViewReader, restaurant_id: str, known_through: dt.date, issue_time: dt.datetime, horizon_days: int = 56,
         history_days: int = HISTORY_DAYS) -> Data:
    since = known_through - dt.timedelta(days=history_days)
    until = known_through + dt.timedelta(days=horizon_days + 2)
    r = reader.rows("restaurants", ["id", "slug", "name", "cuisine", "latitude", "longitude", "council_code", "nation", "prayer_method",
                                    "opening_hours", "special_hours", "trading_day_cutoff"], restaurant_column="id")
    if not r:
        raise ValueError(f"Restaurant {restaurant_id} isn't in analytics.restaurants")
    in_history = [("day", ">=", since), ("day", "<=", known_through)]
    daily = reader.rows("sales_daily", ["day", "net_pence", "gross_pence", "transactions", "covers"], where=in_history, order_by=["day"])
    split = reader.rows("sales_channels", ["day", "hour", "channel", "sales_pence", "includes_vat", "orders", "covers"], where=in_history,
                        order_by=["day", "channel"])
    hourly = reader.rows("sales_hourly", ["day", "hour", "hour_start", "minutes", "transactions", "covers", "calendar_day"], where=in_history,
                         order_by=["day", "hour"])
    items = reader.rows("sales_items", ["day", "quantity", "dish_id", "is_dish"], where=in_history)
    prices = reader.rows("dish_prices", ["dish_id", "price_pence", "effective_from", "recorded_at"], order_by=["effective_from"])
    deals = reader.rows("deals", ["campaign_id", "name", "valid_from", "valid_until", "send_at", "sent_at", "applies_to"])
    events = reader.rows("restaurant_events", ["id", "type", "starts_at", "ends_at", "first_day", "last_day", "treat_as_unusual", "campaign_id"])
    wd = reader.rows("weather_daily", ["day", "temp_max", "temp_min", "rain_mm", "sunshine_hours"],
                     where=[("day", ">=", since), ("day", "<", issue_time.date())], order_by=["day"])
    wh = reader.rows("weather_hourly", ["hour_start", "rain_mm"], where=[("hour_start", ">=", dt.datetime.combine(since, dt.time(), dt.timezone.utc)),
                                                                          ("hour_start", "<", issue_time)])
    wf = reader.rows("weather_forecasts", ["issued_at", "target_day", "hour_start", "temp_max", "temp_min", "rain_mm", "sunshine_hours"],
                     where=[("issued_at", ">=", issue_time - dt.timedelta(days=FORECAST_LOOKBACK_DAYS)), ("issued_at", "<=", issue_time)])
    cal = reader.rows("calendar", ["id", "first_day", "last_day", "starts_at", "ends_at", "name", "type", "scope", "region", "council_code",
                                   "latitude", "longitude", "venue_id", "expected_size", "date_uncertain", "alt_day", "alt_probability"],
                      where=[("last_day", ">=", since), ("first_day", "<=", until)])
    rel = reader.rows("calendar_relevance", ["event_id", "distance_m", "relevant"])
    event_ids = {str(c["id"]) for c in cal}
    fixtures = [f for f in reader.rows("football_fixtures", ["event_id", "competition", "home_team", "away_team", "kickoff_at"], restaurant_column=None)
                if str(f["event_id"]) in event_ids]
    teams = [t["team"] for t in reader.rows("restaurant_teams", ["team"])]
    venues = reader.rows("venues", ["id", "latitude", "longitude", "capacity"], restaurant_column=None)
    prayer = reader.rows("prayer_times", ["day", "dhuhr", "maghrib", "restaurant_uses"], where=[("day", ">=", since), ("day", "<=", until)])
    return Data(
        restaurant=r[0], daily=daily, channels=[x for x in split if x["hour"] is None], channel_hours=[x for x in split if x["hour"] is not None],
        hourly=hourly, items=items, prices=prices, deals=deals, events=events, weather_daily=wd, weather_hourly=wh, weather_forecasts=wf,
        calendar=cal, relevance=rel, fixtures=fixtures, teams=teams, venues=venues, prayer=[p for p in prayer if p.get("restaurant_uses", True)],
    )
