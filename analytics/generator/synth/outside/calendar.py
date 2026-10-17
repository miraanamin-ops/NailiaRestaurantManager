"""The outside calendar: real events from the cached and curated sources, as plain
dicts the simulation and the row builder both use."""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
from pathlib import Path

from ..timeutil import LONDON, UTC, days, iso, last_sunday, london
from .fetch import CACHE

DATA = Path(__file__).resolve().parent / "data"
LONDON_TEAMS = {"West Ham", "Arsenal", "Tottenham", "Chelsea", "Crystal Palace", "Fulham", "Brentford"}


def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf8"))


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    """Great-circle distance, the same formula as ops_distance_m / distanceMetres."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return int(round(2 * r * math.asin(math.sqrt(a))))


def venues() -> list[dict]:
    return _load("venues.json")["venues"]


def _ev(**kw) -> dict:
    base = dict(end_day=None, starts_at=None, ends_at=None, scope="national", region="england", council_code=None,
                latitude=None, longitude=None, venue=None, expected_size=None, date_uncertain=False,
                external_source=None, external_id=None, notes=None, fixture=None, kind=None)
    base.update(kw)
    return base


def bank_holidays(start: dt.date, end: dt.date) -> list[dict]:
    src = json.loads((CACHE / "bank_holidays.json").read_text())
    out = []
    for e in src["events"]:
        d = dt.date.fromisoformat(e["date"])
        if start <= d <= end:
            out.append(_ev(day=d, name=e["title"], type="bank_holiday", kind="bank_holiday",
                           external_source="gov.uk", external_id=e["date"]))
    return out


def religious(start: dt.date, end: dt.date) -> list[dict]:
    src = _load("religious.json")
    out = []
    for e in src["events"]:
        a, b = dt.date.fromisoformat(e["start"]), dt.date.fromisoformat(e["end"])
        if b < start or a > end:
            continue
        note = "Alternative dates: " + ", ".join(e["alternatives"]) if e.get("alternatives") else None
        out.append(_ev(day=a, end_day=b if b != a else None, name=e["name"], type="religious", kind=e["kind"],
                       date_uncertain=e["uncertain"], external_source="east-london-mosque", external_id=f"{e['kind']}:{a}", notes=note))
    for e in src["cultural"]:
        d = dt.date.fromisoformat(e["day"])
        if start <= d <= end:
            out.append(_ev(day=d, name=e["name"], type="cultural", kind="diwali", external_source="council-calendar", external_id=f"diwali:{d}"))
    return out


def school_holidays(council_code: str, start: dt.date, end: dt.date) -> list[dict]:
    terms = _load("school_terms.json")["councils"][council_code]
    spans = []
    ts = terms["terms"]
    for t in ts:
        a, b = (dt.date.fromisoformat(x) for x in t["half_term"])
        spans.append((a, b, "Half term"))
    for prev, nxt in zip(ts, ts[1:]):
        a = dt.date.fromisoformat(prev["end"]) + dt.timedelta(days=1)
        b = dt.date.fromisoformat(nxt["start"]) - dt.timedelta(days=1)
        name = {12: "Christmas holidays", 1: "Christmas holidays", 3: "Easter holidays", 4: "Easter holidays", 7: "Summer holidays"}.get(a.month, "School holidays")
        spans.append((a, b, name))
    out = []
    for a, b, name in sorted(spans):
        if b < start or a > end:
            continue
        out.append(_ev(day=a, end_day=b, name=f"{name} ({terms['name']})", type="school_holiday", kind="school_holiday",
                       scope="council", council_code=council_code, external_source="council-term-dates", external_id=f"{council_code}:{a}"))
    return out


def clock_changes(start: dt.date, end: dt.date) -> list[dict]:
    out = []
    for y in range(start.year, end.year + 1):
        for m, name in ((3, "Clocks go forward"), (10, "Clocks go back")):
            d = last_sunday(y, m)
            if start <= d <= end:
                out.append(_ev(day=d, name=name, type="clock_change", kind="clock_change", external_source="rule", external_id=f"clock:{d}"))
    return out


def paydays(start: dt.date, end: dt.date, bank_days: set[dt.date]) -> list[dict]:
    """The last working day of each month (the most common UK payday)."""
    out = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        d = (dt.date(y + (m == 12), m % 12 + 1, 1)) - dt.timedelta(days=1)
        while d.isoweekday() > 5 or d in bank_days:
            d -= dt.timedelta(days=1)
        if start <= d <= end:
            out.append(_ev(day=d, name="Payday (last working day)", type="payday", kind="payday", external_source="rule", external_id=f"payday:{d}"))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def premier_league(start: dt.date, end: dt.date) -> list[dict]:
    vs = {v["key"]: v for v in venues()}
    out = []
    for f in sorted(CACHE.glob("E0_*.csv")):
        with open(f, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                if not r.get("Date") or not r.get("HomeTeam"):
                    continue
                d = dt.datetime.strptime(r["Date"], "%d/%m/%Y").date()
                if not (start <= d <= end):
                    continue
                home, away = r["HomeTeam"], r["AwayTeam"]
                home = "Tottenham" if home == "Spurs" else home
                away = "Tottenham" if away == "Spurs" else away
                if not ({home, away} & LONDON_TEAMS):
                    continue
                hh, mm = (int(x) for x in (r.get("Time") or "15:00").split(":"))
                ko = london(d, hh, mm).astimezone(UTC)
                at_stadium = home == "West Ham"
                v = vs["london_stadium"] if at_stadium else None
                out.append(_ev(day=d, name=f"{home} v {away}", type="football", kind="premier_league",
                               starts_at=ko, ends_at=ko + dt.timedelta(hours=2), scope="local" if at_stadium else "national",
                               latitude=v["latitude"] if v else None, longitude=v["longitude"] if v else None,
                               venue="london_stadium" if at_stadium else None, expected_size=62500 if at_stadium else None,
                               external_source="football-data.co.uk", external_id=f"E0:{d}:{home}:{away}",
                               fixture={"competition": "Premier League", "home": home, "away": away, "kickoff": ko}))
    return out


def england(start: dt.date, end: dt.date) -> list[dict]:
    out = []
    for m in _load("england.json")["matches"]:
        ko = dt.datetime.fromisoformat(m["kickoff_utc"].replace("Z", "+00:00"))
        d = ko.astimezone(LONDON).date()
        if not (start <= d <= end):
            continue
        out.append(_ev(day=d, name=f"{m['home']} v {m['away']}", type="football", kind="england",
                       starts_at=ko, ends_at=ko + dt.timedelta(hours=2), notes=f"{m['competition']}, {m['venue']}",
                       external_source="wikipedia-england-results", external_id=f"ENG:{m['date']}:{m['home']}:{m['away']}",
                       fixture={"competition": m["competition"], "home": m["home"], "away": m["away"], "kickoff": ko}))
    return out


def venue_events(start: dt.date, end: dt.date) -> list[dict]:
    vs = {v["key"]: v for v in venues()}
    out = []
    for e in _load("venues.json")["events"]:
        a = dt.date.fromisoformat(e["day"])
        b = dt.date.fromisoformat(e.get("end_day", e["day"]))
        if b < start or a > end:
            continue
        v = vs[e["venue"]]
        sh, sm = (int(x) for x in e["starts"].split(":"))
        eh, em = (int(x) for x in e["ends"].split(":"))
        out.append(_ev(day=a, end_day=b if b != a else None, name=f"{e['name']} ({v['name']})", type="local_event", kind="venue",
                       starts_at=london(a, sh, sm).astimezone(UTC), ends_at=london(b, eh, em).astimezone(UTC),
                       scope="local", latitude=v["latitude"], longitude=v["longitude"], venue=e["venue"], expected_size=e["size"],
                       external_source="venue", external_id=f"{e['venue']}:{a}:{e['name']}", notes=e["source"]))
    return out


def all_events(start: dt.date, end: dt.date, council_code: str) -> list[dict]:
    bh = bank_holidays(start, end)
    evs = bh + religious(start, end) + school_holidays(council_code, start, end) + clock_changes(start, end)
    evs += paydays(start, end, {e["day"] for e in bh}) + premier_league(start, end) + england(start, end) + venue_events(start, end)
    return sorted(evs, key=lambda e: (e["day"], e["name"]))


def event_days(e: dict) -> list[dt.date]:
    return list(days(e["day"], e["end_day"] or e["day"]))


def prayer_times(lat: float, lon: float, start: dt.date, end: dt.date) -> dict[dt.date, dict]:
    """Moonsighting Committee Worldwide angles with its seasonal adjustments, Hanafi asr
    (the method most UK South Asian mosques' timetables are based on)."""
    from adhanpy.PrayerTimes import PrayerTimes
    from adhanpy.calculation.CalculationMethod import CalculationMethod
    from adhanpy.calculation.CalculationParameters import CalculationParameters
    from adhanpy.calculation.Madhab import Madhab

    params = CalculationParameters(method=CalculationMethod.MOON_SIGHTING_COMMITTEE)
    params.madhab = Madhab.HANAFI
    out = {}
    for d in days(start, end):
        t = PrayerTimes((lat, lon), dt.datetime(d.year, d.month, d.day), calculation_parameters=params, time_zone=LONDON)
        out[d] = {k: getattr(t, k).astimezone(UTC) for k in ("fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha")}
    return out


__all__ = ["all_events", "prayer_times", "venues", "distance_m", "event_days", "iso"]
