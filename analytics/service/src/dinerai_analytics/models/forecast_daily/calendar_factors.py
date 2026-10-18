"""Calendar and religious factors, built from analytics.calendar for one restaurant.

Each builder returns {factor: {day: value}}; a day not listed is 0.

Uncertain religious dates (date_uncertain, e.g. Ramadan or Eid by moon sighting):
the history uses the recorded dates; a forecast blends the recorded day and the
alternative (alt_day, else the day after), 50/50 unless alt_probability says
otherwise (scenarios()). The 07:00 refresh rebuilds this from the latest
calendar, so a confirmed sighting updates the next days.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, replace
from itertools import product

D1 = dt.timedelta(days=1)

CALENDAR_FACTORS = (
    "bank_holiday", "bh_eve", "bh_after", "xmas_eve", "xmas_week", "nye", "new_year", "mothers_day", "valentines",
    "school_holiday", "inset_day", "payday_window", "clock_change_fwd", "clock_change_back", "diwali",
)
RELIGIOUS_FACTORS = (
    "ramadan_1_10", "ramadan_11_20", "ramadan_last10", "eid_fitr_d1", "eid_fitr_d2", "eid_fitr_d3",
    "eid_adha_d1", "eid_adha_d2", "eid_adha_d3", "chand_raat",
)
PAYDAY_AFTER = 2  # payday and the 2 days after


@dataclass(frozen=True)
class Row:
    id: str
    first_day: dt.date
    last_day: dt.date
    name: str
    type: str
    scope: str
    region: str | None = None
    council_code: str | None = None
    date_uncertain: bool = False
    alt_day: dt.date | None = None
    alt_probability: float | None = None

    @staticmethod
    def from_view(r: dict) -> Row:
        return Row(str(r["id"]), r["first_day"], r["last_day"], r["name"] or "", r["type"], r.get("scope") or "",
                   r.get("region"), r.get("council_code"), bool(r.get("date_uncertain")), r.get("alt_day"),
                   float(r["alt_probability"]) if r.get("alt_probability") is not None else None)

    def shifted(self) -> Row:
        """The row on its alternative dates (the same length)."""
        alt = self.alt_day or self.first_day + D1
        delta = alt - self.first_day
        return replace(self, first_day=alt, last_day=self.last_day + delta, date_uncertain=False)

    @property
    def p_alt(self) -> float:
        return 0.5 if self.alt_probability is None else min(1.0, max(0.0, self.alt_probability))


def easter(year: int) -> dt.date:
    """Easter Sunday (the Gregorian 'anonymous' algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    day = ((h + l_ - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def mothers_day(year: int) -> dt.date:
    """UK Mothering Sunday: three weeks before Easter Sunday."""
    return easter(year) - dt.timedelta(days=21)


def _days(r: Row):
    d = r.first_day
    while d <= r.last_day:
        yield d
        d += D1


def _is(r: Row, word: str) -> bool:
    return word in r.name.lower()


def calendar_factors(days: list[dt.date], rows: list[Row], nation: str | None, council_code: str | None) -> dict[str, dict[dt.date, float]]:
    out: dict[str, dict[dt.date, float]] = defaultdict(dict)
    wanted = set(days)
    years = sorted({d.year for d in days})
    region = (nation or "england").lower()

    bh = {d for r in rows if r.type == "bank_holiday" and (r.region or region).lower() == region for d in _days(r)}
    for d in bh & wanted:
        out["bank_holiday"][d] = 1.0
    for d in bh:
        if d - D1 in wanted and d - D1 not in bh:
            out["bh_eve"][d - D1] = 1.0
        if d + D1 in wanted and d + D1 not in bh:
            out["bh_after"][d + D1] = 1.0

    for y in years:
        for d, f in ((dt.date(y, 12, 24), "xmas_eve"), (dt.date(y, 12, 31), "nye"), (dt.date(y, 1, 1), "new_year"),
                     (mothers_day(y), "mothers_day"), (dt.date(y, 2, 14), "valentines")):
            if d in wanted:
                out[f][d] = 1.0
        for dd in range(27, 31):
            if dt.date(y, 12, dd) in wanted:
                out["xmas_week"][dt.date(y, 12, dd)] = 1.0

    for r in rows:
        if r.type in ("school_holiday", "inset_day") and (r.scope != "council" or not council_code or r.council_code == council_code):
            for d in _days(r):
                if d in wanted:
                    out["inset_day" if r.type == "inset_day" or _is(r, "inset") else "school_holiday"][d] = 1.0
        elif r.type == "payday":
            for k in range(PAYDAY_AFTER + 1):
                if r.first_day + dt.timedelta(days=k) in wanted:
                    out["payday_window"][r.first_day + dt.timedelta(days=k)] = 1.0
        elif r.type == "clock_change" and r.first_day in wanted:
            out["clock_change_fwd" if _is(r, "forward") else "clock_change_back"][r.first_day] = 1.0
        elif r.type == "cultural" and _is(r, "diwali"):
            for d in _days(r):
                if d in wanted:
                    out["diwali"][d] = 1.0
    return out


def religious_factors(days: list[dt.date], rows: list[Row]) -> dict[str, dict[dt.date, float]]:
    out: dict[str, dict[dt.date, float]] = defaultdict(dict)
    wanted = set(days)
    eid_fitr = [r for r in rows if r.type == "religious" and _is(r, "fitr")]
    for r in rows:
        if r.type != "religious":
            continue
        if _is(r, "ramadan"):
            # Ramadan ends the day before Eid al-Fitr (if Eid is recorded earlier than the Ramadan row's end).
            end = r.last_day
            for e in eid_fitr:
                if r.first_day < e.first_day <= end + D1:
                    end = min(end, e.first_day - D1)
            n = (end - r.first_day).days + 1
            for i in range(n):
                d = r.first_day + dt.timedelta(days=i)
                if d in wanted:
                    out["ramadan_1_10" if i < 10 else "ramadan_11_20" if i < 20 else "ramadan_last10"][d] = 1.0
        elif _is(r, "fitr") or _is(r, "adha"):
            kind = "eid_fitr" if _is(r, "fitr") else "eid_adha"
            for k in range(3):
                d = r.first_day + dt.timedelta(days=k)
                if d in wanted:
                    out[f"{kind}_d{k + 1}"][d] = 1.0
            if kind == "eid_fitr" and r.first_day - D1 in wanted:
                out["chand_raat"][r.first_day - D1] = 1.0
    return out


def _near(r: Row, d: dt.date) -> bool:
    """Could this uncertain row affect day d (its days, the night before, and Eid's 3 days, on either date)?"""
    lo = r.first_day - D1
    hi = max(r.last_day, r.shifted().last_day) + dt.timedelta(days=3)
    return lo <= d <= hi


MAX_UNCERTAIN = 3  # at most 2^3 scenarios for one day


def scenarios(day: dt.date, rows: list[Row]) -> list[tuple[float, list[Row]]]:
    """[(probability, rows as they would be)] for one forecast day: one entry when no uncertain date is near,
    else every mix of recorded and alternative dates of the uncertain rows near it."""
    uncertain = [r for r in rows if r.type == "religious" and r.date_uncertain and _near(r, day)][:MAX_UNCERTAIN]
    if not uncertain:
        return [(1.0, rows)]
    others = [r for r in rows if r not in uncertain]
    out = []
    for choice in product((False, True), repeat=len(uncertain)):
        p = 1.0
        chosen = []
        for r, alt in zip(uncertain, choice, strict=True):
            p *= r.p_alt if alt else 1 - r.p_alt
            chosen.append(r.shifted() if alt else r)
        if p > 0:
            out.append((p, others + chosen))
    return out
