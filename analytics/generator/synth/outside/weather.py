"""Real weather from cache/: hourly actuals, London daily summaries, and forecasts as issued."""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from ..timeutil import LONDON
from .fetch import CACHE, LEAD_DAYS, read_json_gz

# WMO weather codes in words (as the app's weather job writes them to weather_days.conditions).
WMO = {0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog", 51: "Light drizzle",
       53: "Drizzle", 55: "Dense drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain",
       65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
       77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Snow showers",
       95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail"}


def hourly(place: str) -> pd.DataFrame:
    j = read_json_gz(CACHE / f"weather_{place}.json.gz")
    df = pd.DataFrame({
        "hour_start": pd.to_datetime(j["time"]).tz_localize("UTC"),
        "temp": j["temperature_2m"], "rain_mm": j["precipitation"], "weather_code": j["weather_code"],
        "cloud_pct": j["cloud_cover"], "wind_kmh": j["wind_speed_10m"],
        "sunshine_min": np.round(np.array(j["sunshine_duration"], dtype=float) / 60.0),
    })
    local = df["hour_start"].dt.tz_convert(LONDON)
    df["day"] = local.dt.date
    df["hour"] = local.dt.hour
    return df


def daily(h: pd.DataFrame) -> pd.DataFrame:
    g = h.groupby("day")
    d = pd.DataFrame({
        "temp_max": g["temp"].max(), "temp_min": g["temp"].min(), "temp_mean": g["temp"].mean().round(1),
        "rain_mm": g["rain_mm"].sum().round(1), "weather_code": g["weather_code"].max(),
        "sunshine_hours": (g["sunshine_min"].sum() / 60.0).round(1),
    })
    d["conditions"] = d["weather_code"].map(lambda c: WMO.get(int(c), None) if pd.notna(c) else None)
    return d


def forecasts(place: str) -> pd.DataFrame:
    """Long table: hour_start, lead (days), temp, rain_mm, sunshine_min, cloud_pct."""
    j = read_json_gz(CACHE / f"forecasts_{place}.json.gz")
    t = pd.to_datetime(j["time"]).tz_localize("UTC")
    frames = []
    for n in LEAD_DAYS:
        sun = np.array(j[f"sunshine_duration_previous_day{n}"], dtype=float)
        frames.append(pd.DataFrame({
            "hour_start": t, "lead": n,
            "temp": j[f"temperature_2m_previous_day{n}"], "rain_mm": j[f"precipitation_previous_day{n}"],
            "sunshine_min": np.round(sun / 60.0), "cloud_pct": j[f"cloud_cover_previous_day{n}"],
        }))
    f = pd.concat(frames, ignore_index=True)
    f["day"] = f["hour_start"].dt.tz_convert(LONDON).dt.date
    return f


def forecast_daily(f: pd.DataFrame) -> pd.DataFrame:
    """Each London day's forecast N days ahead, from the hourly forecasts made N days before.
    issued_at = the London midnight starting the day, minus N days (Open-Meteo gives no issue time)."""
    g = f.groupby(["day", "lead"])
    d = pd.DataFrame({
        "temp_max": g["temp"].max(), "temp_min": g["temp"].min(),
        "rain_mm": g["rain_mm"].sum(min_count=20).round(1),
        "sunshine_hours": (g["sunshine_min"].sum(min_count=20) / 60.0).round(1),
        "hours": g["temp"].count(),
    }).reset_index()
    d = d[d["hours"] >= 23]
    d["issued_at"] = [
        dt.datetime(x.year, x.month, x.day, tzinfo=LONDON).astimezone(dt.timezone.utc) - dt.timedelta(days=int(n))
        for x, n in zip(d["day"], d["lead"])
    ]
    return d


def sunshine_normal(d: pd.DataFrame) -> dict[int, float]:
    """Mean daily sunshine hours per calendar month over the data (the 'normal' the sun effect is measured from)."""
    s = d["sunshine_hours"]
    months = pd.Series([x.month for x in d.index], index=d.index)
    return {int(m): round(float(v), 2) for m, v in s.groupby(months).mean().items()}
