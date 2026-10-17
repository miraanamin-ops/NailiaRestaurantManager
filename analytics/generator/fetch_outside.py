"""Fill cache/ with the real outside data (weather, forecasts as issued, bank holidays,
Premier League fixtures). Usage: py fetch_outside.py --end 2026-10-16 [--only weather,forecasts,calendar]
"""

import argparse
import datetime as dt

from synth.datasets import PLACES, WINDOW_DAYS
from synth.outside import fetch


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--only", default="weather,forecasts,calendar")
    a = ap.parse_args()
    end = dt.date.fromisoformat(a.end)
    # A week of lead-in before the window, so lagged weather and 7-day-ahead forecasts exist from day one.
    start = end - dt.timedelta(days=WINDOW_DAYS + 7)
    fetch.CACHE.mkdir(exist_ok=True)
    only = set(a.only.split(","))
    for place, (lat, lon) in PLACES.items():
        if "weather" in only:
            print("weather", place, fetch.fetch_weather(place, lat, lon, start, end))
        if "forecasts" in only:
            print("forecasts", place, fetch.fetch_forecasts(place, lat, lon, start, end))
    if "calendar" in only:
        print(fetch.fetch_bank_holidays())
        print(fetch.fetch_premier_league())


if __name__ == "__main__":
    main()
