"""Event factors: sport matches, crowds at nearby venues, disruption days.

Sport matches (one builder for every sport; football today, cricket once a
fixtures feed exists):
  intensity = importance (by competition) x relevance (1 if a team is one of the
  restaurant's restaurant_teams or a national team the restaurant type follows,
  in the defaults file, else 0), counted over the open part of two windows:
  <sport>_during  kick-off to +2 hours
  <sport>_after   +2 hours to +4 hours
  as a share of the window, so a match while closed counts 0.

Venues: each calendar row with an expected crowd, every day it runs:
  venue = crowd / 10,000 x exp(-distance / lambda) x relevance
  lambda 2 km by default; distance from calendar_relevance (else worked out from
  the coordinates); relevance from calendar_relevance (true 1, false 0, not
  decided 1).

Disruption: 1 on each day of a 'disruption' calendar row.
"""

from __future__ import annotations

import datetime as dt
import math
from collections import defaultdict
from dataclasses import dataclass

from ...cutoff import LONDON
from .hours import DayHours, hour_trading_day, overlap_minutes

DURING_H, AFTER_H = 2, 4
VENUE_LAMBDA_KM = 2.0
VENUE_UNIT = 10_000
SPORTS = ("football", "cricket")
SPORT_FACTORS = tuple(f"{s}_{w}" for s in SPORTS for w in ("during", "after"))
EVENT_FACTORS = (*SPORT_FACTORS, "venue", "disruption")


@dataclass(frozen=True)
class Match:
    sport: str
    competition: str
    home: str
    away: str
    kickoff: dt.datetime


def importance(competition: str) -> float:
    """friendly 0.5; league, cup or qualifier 1; tournament group 1.5; knockout 2; semi-final or final 2.5."""
    c = (competition or "").lower()
    if "friendly" in c:
        return 0.5
    if "semi" in c or c.endswith(" final") or c == "final":
        return 2.5
    if any(w in c for w in ("quarter", "round of", "third place", "knockout", "play-off", "playoff")):
        return 2.0
    if "group" in c:
        return 1.5
    return 1.0


def relevance(m: Match, teams: set[str], national: set[str]) -> float:
    return 1.0 if ({m.home, m.away} & (teams | national)) else 0.0


def sport_factors(matches: list[Match], teams: set[str], national_by_sport: dict[str, set[str]],
                  hours_by_day: dict[dt.date, DayHours], cutoff_hour: int) -> dict[str, dict[dt.date, float]]:
    out: dict[str, dict[dt.date, float]] = defaultdict(dict)
    for m in matches:
        rel = relevance(m, teams, national_by_sport.get(m.sport, set()))
        if not rel:
            continue
        local = m.kickoff.astimezone(LONDON)
        day = hour_trading_day(local.date(), local.hour, cutoff_hour)
        h = hours_by_day.get(day)
        if h is None:
            continue
        w = importance(m.competition) * rel
        for name, a, b in (("during", 0, DURING_H), ("after", DURING_H, AFTER_H)):
            start, end = m.kickoff + dt.timedelta(hours=a), m.kickoff + dt.timedelta(hours=b)
            share = overlap_minutes(h.intervals, start, end) / ((end - start).total_seconds() / 60)
            if share > 0:
                key = f"{m.sport}_{name}"
                out[key][day] = out[key].get(day, 0.0) + w * share
    return out


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def venue_value(crowd: float, distance_km: float, relevant: bool | None, lam_km: float = VENUE_LAMBDA_KM) -> float:
    rel = 0.0 if relevant is False else 1.0
    return crowd / VENUE_UNIT * math.exp(-distance_km / lam_km) * rel


def venue_factors(rows: list[dict], relevance_by_event: dict[str, dict], venues: dict[str, dict], restaurant: dict,
                  lam_km: float = VENUE_LAMBDA_KM) -> dict[str, dict[dt.date, float]]:
    out: dict[str, dict[dt.date, float]] = defaultdict(dict)
    for r in rows:
        if r.get("expected_size") is None:
            continue
        rel = relevance_by_event.get(str(r["id"]), {})
        dist_m = rel.get("distance_m")
        if dist_m is not None:
            km = float(dist_m) / 1000
        else:
            lat, lon = r.get("latitude"), r.get("longitude")
            v = venues.get(str(r["venue_id"])) if r.get("venue_id") else None
            if (lat is None or lon is None) and v:
                lat, lon = v.get("latitude"), v.get("longitude")
            if lat is None or lon is None or restaurant.get("latitude") is None:
                continue
            km = haversine_km(float(restaurant["latitude"]), float(restaurant["longitude"]), float(lat), float(lon))
        value = venue_value(float(r["expected_size"]), km, rel.get("relevant"), lam_km)
        if value <= 0:
            continue
        d = r["first_day"]
        while d <= r["last_day"]:
            out["venue"][d] = out["venue"].get(d, 0.0) + value
            d += dt.timedelta(days=1)
    for r in rows:
        if r["type"] == "disruption":
            d = r["first_day"]
            while d <= r["last_day"]:
                out["disruption"][d] = 1.0
                d += dt.timedelta(days=1)
    return out
