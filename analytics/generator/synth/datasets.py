"""The four demo restaurants and every effect baked into them.

Each number here is a named parameter, documented in README.md and copied into
ground_truth.json, so a model's estimate can be checked against the truth.
Effects multiply the expected number of orders (unless a comment says otherwise).
"""

from __future__ import annotations

import copy
import datetime as dt

# Where the real outside data is fetched for (latitude, longitude).
PLACES = {
    "ilford": (51.55200, 0.07450),       # Ilford Lane, Redbridge
    "walthamstow": (51.58500, -0.01800),  # Hoe Street, Waltham Forest
    "stratford": (51.54180, 0.00100),     # Stratford Broadway, Newham
}

# 24 months ending yesterday: start = the day after the same date two years before the end.
WINDOW_DAYS = 731


def window(end: dt.date) -> tuple[dt.date, dt.date]:
    start = end.replace(year=end.year - 2) + dt.timedelta(days=1)
    return start, end


HALAL = {
    "key": "halal_ilford",
    "id": "33333333-3333-3333-3333-333333333333",
    "name": "Saffron Lane Kitchen (demo)",
    "slug": "demo-saffron-lane",
    "cuisine": "Halal South Asian",
    "address": "Ilford Lane, Ilford IG1 (demo)",
    "place": "ilford",
    "council": {"code": "E09000026", "name": "Redbridge"},
    "prayer_method": "computed:moonsighting_committee+hanafi",
    "trading_day_cutoff": "05:00",
    "menu": "south_asian",
    "seed_offset": 1,
    # Opening hours: (open, close) as hours from the start of the trading day; 24 = midnight.
    "hours": {d: (12, 23) for d in range(1, 5)} | {5: (12, 24), 6: (12, 24), 7: (12, 23)},
    "demand": {
        "base_orders": 62,            # expected orders on a plain Wednesday at the start of the window
        "trend_per_year": 0.05,       # +5% a year, compounding daily
        "dow": [0.80, 0.78, 0.84, 0.95, 1.30, 1.42, 1.20],  # Monday to Sunday
        "season_amplitude": 0.04,     # cosine over the year
        "season_peak_doy": 345,       # mid December peak
        "noise_sigma": 0.07,          # log-normal day-to-day noise
        "shock_rate_per_year": 2.0,   # unexplained one-day shocks (Poisson)
        "shock_sigma": 0.25,          # log size of a shock
    },
    "channels": {"dine_in": 0.52, "takeaway": 0.23, "delivery": 0.25},
    "party": {"dine_in_mean": 2.6, "weekend_dine_in_mean": 3.6, "takeaway_mean": 2.2, "delivery_mean": 2.3},
    "hourly": {
        "normal": {12: 4, 13: 6, 14: 4, 15: 2, 16: 2, 17: 5, 18: 9, 19: 13, 20: 13, 21: 10, 22: 6, 23: 3},
        "weekend": {12: 5, 13: 8, 14: 7, 15: 5, 16: 5, 17: 7, 18: 10, 19: 13, 20: 13, 21: 11, 22: 8, 23: 5},
    },
    "effects": {
        "jummah": {"friday_hours": [13, 14, 15], "lift": 0.60},  # Friday after-prayer lunch lift (hourly weight)
        "weather": {
            # log-multipliers per channel: rain = per mm (capped at 10 mm) during trading hours,
            # temp = per degree C away from 15, sun = per hour of sunshine above the month's normal
            "rain": {"dine_in": -0.025, "takeaway": -0.010, "delivery": 0.030},
            "temp_hot_above": 26, "temp_hot": {"dine_in": -0.03, "takeaway": 0.0, "delivery": 0.01},
            "temp": {"dine_in": 0.0, "takeaway": 0.0, "delivery": 0.0},
            "sun": {"dine_in": 0.0, "takeaway": 0.0, "delivery": 0.0},
        },
        "bank_holiday": 1.15,
        "closed_days": ["12-25"],
        "christmas_eve": 0.8,
        "new_years_eve": 1.25,
        "ramadan": {
            "day_total": 1.12,        # the whole day, in Ramadan
            "daytime": 0.30,          # hours that end before maghrib
            "iftar_surge": 2.6,       # the hour of maghrib and the one after (weights x this)
            "late_peak": 1.8,         # 21:00 to close
            "late_close_extra_hours": 1,  # opens an hour later at night in Ramadan
            "dine_in_share_shift": 0.08,  # dine-in share rises by this (from takeaway) in Ramadan
        },
        "chand_raat": 1.30,           # the evening before Eid al-Fitr
        "eid_fitr": [1.90, 1.45, 1.20],
        "eid_adha": [1.55, 1.25],
        "school_holiday": 1.05,
        "school_holiday_lunch": 1.25,  # hours 12 to 15 on weekdays in school holidays
        "football": {"teams": [], "england": 0.92, "team": 1.0},  # England match evenings: fewer dine-in diners
        "venue": {"scale_m": 2000, "max_lift": 0.0},
        "payday": 1.04,               # payday Friday to Sunday
        "clock_change": 1.0,
    },
    "price_rises": [
        {"day": "2025-04-07", "pct": 0.05, "sections": ["Mains", "Grills"], "note": "April costs rise"},
    ],
    "elasticity": -0.9,               # dish choice: weight x (price / first price) ^ elasticity
    "order_elasticity": -0.4,         # visits: orders x (menu price index) ^ order_elasticity
    "new_dishes": [],
    "closures": [],
    "unexplained": [],
    "team": [],
    "cash_share": [0.22, 0.14],       # cash share of payments at start and end
}

CAFE = {
    "key": "cafe_walthamstow",
    "id": "44444444-4444-4444-4444-444444444444",
    "name": "Fern and Fold Cafe (demo)",
    "slug": "demo-fern-and-fold",
    "cuisine": "Cafe and brunch",
    "address": "Hoe Street, Walthamstow E17 (demo)",
    "place": "walthamstow",
    "council": {"code": "E09000031", "name": "Waltham Forest"},
    "prayer_method": "computed:moonsighting_committee+hanafi",
    "trading_day_cutoff": "05:00",
    "menu": "cafe",
    "seed_offset": 2,
    "hours": {d: (8, 17) for d in range(1, 6)} | {6: (8, 17), 7: (9, 16)},
    "demand": {
        "base_orders": 72, "trend_per_year": 0.03,
        "dow": [0.82, 0.80, 0.84, 0.88, 1.00, 1.60, 1.45],
        "season_amplitude": 0.06, "season_peak_doy": 200,
        "noise_sigma": 0.08, "shock_rate_per_year": 2.0, "shock_sigma": 0.25,
    },
    "channels": {"dine_in": 0.86, "takeaway": 0.12, "delivery": 0.02},
    "party": {"dine_in_mean": 1.8, "weekend_dine_in_mean": 2.6, "takeaway_mean": 1.2, "delivery_mean": 1.6},
    "hourly": {
        "normal": {8: 9, 9: 11, 10: 10, 11: 9, 12: 12, 13: 12, 14: 8, 15: 5, 16: 3},
        "weekend": {8: 4, 9: 9, 10: 14, 11: 16, 12: 15, 13: 13, 14: 9, 15: 6, 16: 3},
    },
    "effects": {
        "jummah": None,
        "weather": {
            "rain": {"dine_in": -0.030, "takeaway": -0.040, "delivery": 0.040},
            "temp_hot_above": 28, "temp_hot": {"dine_in": -0.02, "takeaway": 0.02, "delivery": 0.0},
            "temp": {"dine_in": 0.008, "takeaway": 0.010, "delivery": 0.0},   # warmer days are busier
            "sun": {"dine_in": 0.025, "takeaway": 0.030, "delivery": 0.0},    # per hour of sun above normal
        },
        "bank_holiday": 1.30,
        "closed_days": ["12-25", "12-26", "01-01"],
        "christmas_eve": 0.9,
        "new_years_eve": 0.7,
        "ramadan": None,
        "chand_raat": 1.0, "eid_fitr": [], "eid_adha": [],
        "school_holiday": 1.14,
        "school_holiday_lunch": 1.0,
        "football": {"teams": [], "england": 1.0, "team": 1.0},
        "venue": {"scale_m": 2000, "max_lift": 0.0},
        "payday": 1.02,
        "clock_change": 1.0,
    },
    "price_rises": [
        {"day": "2025-03-03", "pct": 0.06, "sections": ["Coffee", "Brunch"], "note": "milk and coffee costs"},
    ],
    "elasticity": -0.7,
    "order_elasticity": -0.3,
    "new_dishes": [],
    "closures": [],
    "unexplained": [],
    "team": [],
    "cash_share": [0.12, 0.06],
}

TAKEAWAY = {
    "key": "takeaway_stratford",
    "id": "55555555-5555-5555-5555-555555555555",
    "name": "Broadway Late Grill (demo)",
    "slug": "demo-broadway-late-grill",
    "cuisine": "Takeaway: peri-peri, burgers, pizza",
    "address": "The Broadway, Stratford E15 (demo)",
    "place": "stratford",
    "council": {"code": "E09000025", "name": "Newham"},
    "prayer_method": "computed:moonsighting_committee+hanafi",
    "trading_day_cutoff": "05:00",
    "menu": "takeaway",
    "seed_offset": 3,
    # Open till 01:00 (02:00 Friday and Saturday): the hours after midnight belong to the trading day.
    "hours": {d: (16, 25) for d in range(1, 5)} | {5: (16, 26), 6: (14, 26), 7: (14, 25)},
    "demand": {
        "base_orders": 88, "trend_per_year": 0.07,
        "dow": [0.82, 0.78, 0.82, 0.92, 1.30, 1.38, 1.08],
        "season_amplitude": 0.07, "season_peak_doy": 20,   # winter peak
        "noise_sigma": 0.09, "shock_rate_per_year": 3.0, "shock_sigma": 0.30,
    },
    "channels": {"dine_in": 0.06, "takeaway": 0.24, "delivery": 0.70},
    "party": {"dine_in_mean": 1.6, "weekend_dine_in_mean": 1.9, "takeaway_mean": 1.5, "delivery_mean": 1.8},
    "hourly": {
        "normal": {16: 3, 17: 6, 18: 10, 19: 13, 20: 14, 21: 13, 22: 11, 23: 8, 0: 5, 1: 2},
        "weekend": {14: 3, 15: 3, 16: 4, 17: 6, 18: 9, 19: 12, 20: 13, 21: 13, 22: 12, 23: 11, 0: 8, 1: 5},
    },
    "effects": {
        "jummah": None,
        "weather": {
            "rain": {"dine_in": -0.030, "takeaway": -0.020, "delivery": 0.045},
            "temp_hot_above": 26, "temp_hot": {"dine_in": 0.0, "takeaway": -0.01, "delivery": -0.02},
            "temp": {"dine_in": 0.0, "takeaway": 0.0, "delivery": -0.004},   # colder = a little busier
            "sun": {"dine_in": 0.0, "takeaway": 0.0, "delivery": -0.010},
        },
        "bank_holiday": 1.08,
        "closed_days": ["12-25"],
        "christmas_eve": 0.85,
        "new_years_eve": 1.10,
        "ramadan": {
            "day_total": 1.06, "daytime": 0.55, "iftar_surge": 1.8, "late_peak": 1.3,
            "late_close_extra_hours": 0, "dine_in_share_shift": 0.0,
        },
        "chand_raat": 1.15, "eid_fitr": [1.20, 1.05], "eid_adha": [1.10],
        "school_holiday": 1.0,
        "school_holiday_lunch": 1.0,
        # Matches of these teams on TV: lift on the evening of the match (orders around kick-off).
        "football": {"teams": ["West Ham", "Arsenal", "Tottenham"], "england": 1.35, "team": 1.12},
        # Crowds near the restaurant: lift = max_lift x exp(-distance / scale_m) x size / 60,000.
        "venue": {"scale_m": 2000, "max_lift": 0.45},
        "payday": 1.10,
        "clock_change": 1.0,
    },
    "price_rises": [
        {"day": "2025-05-12", "pct": 0.07, "sections": ["Peri-peri chicken", "Burgers"], "note": "chicken prices"},
    ],
    "elasticity": -1.2,
    "order_elasticity": -0.6,
    "new_dishes": [],
    "closures": [],
    "unexplained": [],
    "team": ["West Ham", "Arsenal", "Tottenham"],
    "cash_share": [0.10, 0.05],
}


def _messy() -> dict:
    """Dataset 4: the same restaurant and seed as dataset 1 (so the same behaviour
    until something changes), plus real changes and data-quality problems."""
    m = copy.deepcopy(HALAL)
    m.update({
        "key": "halal_ilford_messy",
        "id": "66666666-6666-6666-6666-666666666666",
        "name": "Saffron Lane Kitchen, messy copy (demo)",
        "slug": "demo-saffron-lane-messy",
        "seed_offset": 1,  # the same random numbers as dataset 1
        "messy": True,
    })
    m["price_rises"] = HALAL["price_rises"] + [
        {"day": "2026-01-12", "pct": 0.12, "sections": ["Mains", "Grills", "Biryani"], "note": "big January price rise"},
    ]
    m["elasticity"] = -1.1
    m["order_elasticity"] = -0.5
    m["new_dishes"] = [
        # Launched mid-window: demand builds up over ramp_days and takes some orders from the sibling dish.
        {"name": "Lamb Nihari", "launch": "2025-09-15", "ramp_days": 35, "cannibalises": "Lamb Karahi", "share": 0.35},
    ]
    m["closures"] = [{"start": "2025-08-04", "end": "2025-08-17", "type": "refit", "note": "kitchen refit, closed two weeks"}]
    m["unexplained"] = [{"start": "2026-06-01", "end": "2026-06-07", "multiplier": 0.70}]
    m["mess"] = {
        "missing_day_rate": 0.04,        # till reports never sent (sales rows missing, trading happened)
        "duplicate_item_rate": 0.015,    # item lines imported twice (different row keys)
        "renamed_till_from": "2025-11-03",  # the till was reprogrammed: new names from this day
        "typo_rate": 0.02,               # item lines with a typo in the till name
        "malformed_rows_per_file": 6,    # broken lines in each POS export
        "duplicate_rows_per_file": 4,    # repeated lines in each POS export
    }
    return m


MESSY = _messy()

DATASETS = {d["key"]: d for d in [HALAL, CAFE, TAKEAWAY, MESSY]}

# How many days the --fixture profile keeps (the 3-week datasets committed for CI).
FIXTURE_DAYS = 21
