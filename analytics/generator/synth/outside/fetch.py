"""Fetch the real outside data once and keep a copy in cache/.

Everything the generator uses from the outside world comes from cache/, so a run
works offline and gives the same result every time, even if a provider later
revises its numbers. Run `py fetch_outside.py --end YYYY-MM-DD` to (re)fill it.

  weather_<place>.json.gz  Open-Meteo archive, hourly, UTC (recent days the
                           archive does not have yet come from the forecast API)
  forecasts_<place>.json.gz Open-Meteo Previous Runs (ECMWF IFS 0.25): the forecast
                           for each hour as issued 1 to 7 days before
  bank_holidays.json       gov.uk
  E0_<season>.csv          football-data.co.uk Premier League results with kick-offs
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import time
from pathlib import Path

import requests

CACHE = Path(__file__).resolve().parents[2] / "cache"

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"
PREVIOUS = "https://previous-runs-api.open-meteo.com/v1/forecast"
HOURLY = ["temperature_2m", "precipitation", "weather_code", "cloud_cover", "wind_speed_10m", "sunshine_duration"]
FORECAST_VARS = ["temperature_2m", "precipitation", "sunshine_duration", "cloud_cover"]
LEAD_DAYS = range(1, 8)
FORECAST_MODEL = "ecmwf_ifs025"
SEASONS = ["2425", "2526", "2627"]


def write_json_gz(path: Path, obj) -> Path:
    # mtime=0 so the same data always gives the same bytes.
    with open(path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as fh:
        fh.write(json.dumps(obj).encode("utf8"))
    return path


def read_json_gz(path: Path):
    return json.loads(gzip.decompress(path.read_bytes()))


def _get(url: str, params: dict, tries: int = 5) -> dict:
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=180)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                time.sleep(30 * (i + 1))
                continue
            raise RuntimeError(f"{url}: HTTP {r.status_code} {r.text[:200]}")
        except requests.RequestException:
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"{url}: no answer after {tries} tries")


def _chunks(start: dt.date, end: dt.date, days: int):
    d = start
    while d <= end:
        e = min(end, d + dt.timedelta(days=days - 1))
        yield d, e
        d = e + dt.timedelta(days=1)


def fetch_weather(place: str, lat: float, lon: float, start: dt.date, end: dt.date) -> Path:
    times: list[str] = []
    cols: dict[str, list] = {v: [] for v in HOURLY}
    for a, b in _chunks(start, end, 200):
        j = _get(ARCHIVE, dict(latitude=lat, longitude=lon, start_date=a.isoformat(), end_date=b.isoformat(), hourly=",".join(HOURLY), timezone="UTC"))
        times += j["hourly"]["time"]
        for v in HOURLY:
            cols[v] += j["hourly"][v]
    # The archive runs a few days behind: fill its gaps from the forecast API's recent past.
    missing = [i for i, t in enumerate(times) if cols["temperature_2m"][i] is None]
    filled_from_forecast = 0
    if missing:
        j = _get(FORECAST, dict(latitude=lat, longitude=lon, past_days=14, forecast_days=1, hourly=",".join(HOURLY), timezone="UTC"))
        recent = {t: i for i, t in enumerate(j["hourly"]["time"])}
        for i in missing:
            k = recent.get(times[i])
            if k is None:
                continue
            for v in HOURLY:
                cols[v][i] = j["hourly"][v][k]
            filled_from_forecast += 1
    return write_json_gz(CACHE / f"weather_{place}.json.gz", {
        "place": place, "latitude": lat, "longitude": lon, "start": start.isoformat(), "end": end.isoformat(),
        "provider": "open-meteo archive (ERA5)", "fetched_on": dt.date.today().isoformat(),
        "hours_from_forecast_api": filled_from_forecast, "time": times, **cols,
    })


def fetch_forecasts(place: str, lat: float, lon: float, start: dt.date, end: dt.date) -> Path:
    names = [f"{v}_previous_day{n}" for v in FORECAST_VARS for n in LEAD_DAYS]
    times: list[str] = []
    cols: dict[str, list] = {n: [] for n in names}
    for a, b in _chunks(start, end, 92):
        j = _get(PREVIOUS, dict(latitude=lat, longitude=lon, start_date=a.isoformat(), end_date=b.isoformat(), hourly=",".join(names), models=FORECAST_MODEL, timezone="UTC"))
        times += j["hourly"]["time"]
        for n in names:
            cols[n] += j["hourly"][n]
    return write_json_gz(CACHE / f"forecasts_{place}.json.gz", {
        "place": place, "latitude": lat, "longitude": lon, "start": start.isoformat(), "end": end.isoformat(),
        "provider": f"open-meteo previous runs ({FORECAST_MODEL})", "fetched_on": dt.date.today().isoformat(),
        "time": times, **cols,
    })


def fetch_bank_holidays() -> Path:
    j = _get("https://www.gov.uk/bank-holidays.json", {})
    out = CACHE / "bank_holidays.json"
    out.write_text(json.dumps({"source": "https://www.gov.uk/bank-holidays.json", "fetched_on": dt.date.today().isoformat(),
                               "events": j["england-and-wales"]["events"]}, indent=1))
    return out


def fetch_premier_league() -> list[Path]:
    outs = []
    for s in SEASONS:
        r = requests.get(f"https://www.football-data.co.uk/mmz4281/{s}/E0.csv", timeout=120)
        r.raise_for_status()
        out = CACHE / f"E0_{s}.csv"
        out.write_bytes(r.content)
        outs.append(out)
    return outs
