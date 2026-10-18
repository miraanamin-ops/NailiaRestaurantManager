"""A small made-up restaurant for the forecast_daily tests: no database, no generator files.

Orders follow the weekday with Poisson noise, split into three channels and into
hours by a fixed profile; plus weather (archive, hourly rain, and forecasts issued
1 to 7 days ahead), a calendar with an uncertain Eid, prayer times, a deal and a
price change. Everything is built from a seed, so it is the same every time.
"""

from __future__ import annotations

import datetime as dt
import math
import random

from dinerai_analytics.cutoff import LONDON, UTC
from dinerai_analytics.models.forecast_daily.data import Data

RID = "abcdabcd-0000-0000-0000-000000000001"
HOURS = {d: "12:00 – 23:00" for d in ("Monday", "Tuesday", "Wednesday", "Thursday", "Sunday")} | {"Friday": "12:00 – 00:00", "Saturday": "12:00 – 00:00"}
WEEKDAY = (0.8, 0.8, 0.9, 0.95, 1.25, 1.45, 1.1)
PROFILE = {12: 4, 13: 8, 14: 5, 15: 3, 16: 3, 17: 5, 18: 9, 19: 12, 20: 11, 21: 8, 22: 5, 23: 2}
SHARES = {"dine_in": 0.5, "takeaway": 0.25, "delivery": 0.25}
SPEND = {"dine_in": 3000, "takeaway": 2200, "delivery": 2500}  # pence incl VAT


def local(day: dt.date, hour: int, minute: int = 0) -> dt.datetime:
    d = day + dt.timedelta(days=hour // 24)
    return dt.datetime(d.year, d.month, d.day, hour % 24, minute, tzinfo=LONDON).astimezone(UTC)


def make_data(end: dt.date = dt.date(2026, 9, 30), days: int = 200, seed: int = 1, eid: dt.date | None = None,
              eid_uncertain: bool = True, eid_alt: dt.date | None = None) -> Data:
    rng = random.Random(seed)
    start = end - dt.timedelta(days=days - 1)
    all_days = [start + dt.timedelta(days=i) for i in range(days)]
    daily, channels, channel_hours, hourly, items, weather_daily, weather_hourly, forecasts, prayer = [], [], [], [], [], [], [], [], []
    for d in all_days:
        n = _poisson(rng, 60 * WEEKDAY[d.weekday()])
        split = {c: 0 for c in SHARES}
        for _ in range(n):
            split[_pick(rng, SHARES)] += 1
        sales_gross = 0
        hours_tot: dict[int, int] = {}
        for c, k in split.items():
            per_hour: dict[int, int] = {}
            for _ in range(k):
                h = _pick(rng, PROFILE)
                per_hour[h] = per_hour.get(h, 0) + 1
            gross_c = k * SPEND[c]
            sales_gross += gross_c
            channels.append({"day": d, "hour": None, "channel": c, "sales_pence": gross_c, "includes_vat": True, "orders": k,
                             "covers": round(k * 2.5) if c == "dine_in" else None})
            for h, m in per_hour.items():
                hour = h % 24
                channel_hours.append({"day": d, "hour": hour, "channel": c, "sales_pence": m * SPEND[c], "includes_vat": True, "orders": m,
                                      "covers": round(m * 2.5) if c == "dine_in" else None})
                hours_tot[hour] = hours_tot.get(hour, 0) + m
        for hour, m in hours_tot.items():
            hourly.append({"day": d, "hour": hour, "hour_start": local(d, hour if hour >= 5 else hour + 24), "minutes": 60, "transactions": m,
                           "covers": None, "calendar_day": d if hour >= 5 else d + dt.timedelta(days=1)})
        daily.append({"day": d, "net_pence": round(sales_gross / 1.2), "gross_pence": sales_gross, "transactions": n, "covers": round(split["dine_in"] * 2.5)})
        items.append({"day": d, "quantity": n, "dish_id": "dish-1", "is_dish": True})
        doy = d.timetuple().tm_yday
        t = 11 + 7 * math.cos(2 * math.pi * (doy - 200) / 365.25) + rng.gauss(0, 2)
        rain = max(0.0, rng.gauss(0, 3))
        weather_daily.append({"day": d, "temp_max": t + 4, "temp_min": t - 4, "rain_mm": round(rain, 1), "sunshine_hours": max(0.0, rng.gauss(5, 3))})
        for h in range(24):
            weather_hourly.append({"hour_start": local(d, h), "rain_mm": round(rain / 24, 2)})
        maghrib = local(d, 18, 30) + dt.timedelta(minutes=int(60 * math.cos(2 * math.pi * (doy - 172) / 365.25)))
        prayer.append({"day": d, "dhuhr": local(d, 12, 10), "maghrib": maghrib, "restaurant_uses": True})
    # Forecasts issued at London midnight, 1 to 7 days ahead, for the history and 60 days on.
    for i in range(days + 60):
        target = start + dt.timedelta(days=i)
        for ahead in range(1, 8):
            issued = local(target - dt.timedelta(days=ahead), 0)
            forecasts.append({"issued_at": issued, "target_day": target, "hour_start": None, "temp_max": 18.0 + ahead * 0.1, "temp_min": 9.0,
                              "rain_mm": 1.0, "sunshine_hours": 5.0})
    eid = eid or end + dt.timedelta(days=5)
    calendar = [
        {"id": "bh-1", "first_day": dt.date(2026, 8, 31), "last_day": dt.date(2026, 8, 31), "starts_at": None, "ends_at": None, "name": "Summer bank holiday",
         "type": "bank_holiday", "scope": "national", "region": "england", "council_code": None, "latitude": None, "longitude": None, "venue_id": None,
         "expected_size": None, "date_uncertain": False, "alt_day": None, "alt_probability": None},
        {"id": "eid-1", "first_day": eid, "last_day": eid, "starts_at": None, "ends_at": None, "name": "Eid al-Fitr", "type": "religious", "scope": "national",
         "region": "england", "council_code": None, "latitude": None, "longitude": None, "venue_id": None, "expected_size": None,
         "date_uncertain": eid_uncertain, "alt_day": eid_alt, "alt_probability": None},
        {"id": "pay-1", "first_day": dt.date(2026, 9, 30), "last_day": dt.date(2026, 9, 30), "starts_at": None, "ends_at": None, "name": "Payday",
         "type": "payday", "scope": "national", "region": "england", "council_code": None, "latitude": None, "longitude": None, "venue_id": None,
         "expected_size": None, "date_uncertain": False, "alt_day": None, "alt_probability": None},
    ]
    deals = [{"campaign_id": "deal-1", "name": "Test deal", "valid_from": end - dt.timedelta(days=40), "valid_until": end - dt.timedelta(days=30),
              "send_at": local(end - dt.timedelta(days=41), 10), "sent_at": local(end - dt.timedelta(days=41), 10), "applies_to": None}]
    prices = [{"dish_id": "dish-1", "price_pence": 1000, "effective_from": start - dt.timedelta(days=100),
               "recorded_at": local(start - dt.timedelta(days=101), 9)},
              {"dish_id": "dish-1", "price_pence": 1100, "effective_from": end - dt.timedelta(days=60), "recorded_at": local(end - dt.timedelta(days=63), 9)}]
    restaurant = {"id": RID, "slug": "test-forecast", "name": "Test Grill", "cuisine": "Halal grill", "latitude": 51.55, "longitude": 0.07,
                  "council_code": "E09000026", "nation": "england", "prayer_method": "x", "opening_hours": HOURS, "special_hours": {},
                  "trading_day_cutoff": dt.time(5, 0)}
    return Data(restaurant=restaurant, daily=daily, channels=channels, channel_hours=channel_hours, hourly=hourly, items=items, prices=prices,
                deals=deals, events=[], weather_daily=weather_daily, weather_hourly=weather_hourly, weather_forecasts=forecasts, calendar=calendar,
                relevance=[], fixtures=[], teams=[], venues=[], prayer=prayer)


def _poisson(rng: random.Random, lam: float) -> int:
    # Knuth's method is fine for these small means.
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _pick(rng: random.Random, weights: dict) -> object:
    total = sum(weights.values())
    r = rng.random() * total
    for k, w in weights.items():
        r -= w
        if r <= 0:
            return k
    return k
