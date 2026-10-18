"""The editable defaults (the priors): one JSON file per restaurant type in defaults/.

general.json is complete; halal.json, cafe.json and takeaway.json list only what
differs. The restaurant's type comes from its cuisine (restaurant_type). Each
factor's effect_pct is the % change in orders, so its prior mean on the log scale
is log(1 + pct/100); log_price_index gives its coefficient (an elasticity) directly.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent / "defaults"
TYPES = ("general", "halal", "cafe", "takeaway")
CHANNELS = ("dine_in", "takeaway", "delivery")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def restaurant_type(cuisine: str | None) -> str:
    """halal, cafe (cafe, brunch, bakery), takeaway, else general. Halal first: a halal takeaway is halal."""
    c = (cuisine or "").lower()
    if "halal" in c:
        return "halal"
    if any(w in c for w in ("cafe", "café", "brunch", "bakery", "coffee")):
        return "cafe"
    if "takeaway" in c or "take-away" in c:
        return "takeaway"
    return "general"


@lru_cache(maxsize=8)
def load(kind: str) -> dict:
    """The merged defaults for a type: general.json with the type's file on top."""
    if kind not in TYPES:
        raise ValueError(f"Unknown restaurant type {kind!r}")
    base = json.loads((HERE / "general.json").read_text(encoding="utf8"))
    if kind == "general":
        return base
    over = json.loads((HERE / f"{kind}.json").read_text(encoding="utf8"))
    merged = {**base, **{k: v for k, v in over.items() if k not in ("factors", "sports")}}
    merged["factors"] = {**base["factors"], **over.get("factors", {})}
    merged["sports"] = {**base["sports"], **over.get("sports", {})}
    merged["type"] = kind
    return merged


@dataclass(frozen=True)
class Prior:
    mean: float
    sd: float


def _log_pct(pct: float) -> float:
    return math.log1p(pct / 100.0)


def factor_prior(d: dict, factor: str, channel: str) -> Prior:
    """The prior for one factor on one channel. Deals share the 'deal' entry; per-weekday
    summer terms share 'weekday_summer'."""
    key = "deal" if factor.startswith("deal:") else "weekday_summer" if factor.startswith("wd_summer_") else factor
    e = d["factors"][key]
    if "coefficient" in e:
        return Prior(float(e["coefficient"]), float(e["sd"]))
    pct = e["effect_pct"]
    value = pct.get(channel, pct.get("all", 0.0)) if channel != "all" else pct.get("all")
    return Prior(_log_pct(float(value)) if value is not None else math.nan, float(e["sd"]))


def all_channel_prior(d: dict, factor: str, shares: dict[str, float]) -> Prior:
    """For the direct all-channel model: the 'all' number if given, else the channels'
    log effects weighted by their share of orders."""
    p = factor_prior(d, factor, "all")
    if not math.isnan(p.mean):
        return p
    total = sum(shares.values()) or 1.0
    mean = sum(shares.get(c, 0.0) / total * factor_prior(d, factor, c).mean for c in CHANNELS)
    return Prior(mean, p.sd)


def weekday_priors(d: dict) -> tuple[list[float], float]:
    """Log weekday effects Monday to Sunday, centred on 0, and their sd."""
    w = d["weekday_pct"]
    logs = [_log_pct(float(w["values"][k])) for k in WEEKDAYS]
    mean = sum(logs) / 7
    return [v - mean for v in logs], float(w["sd"])


def season_priors(d: dict, k_terms: int) -> tuple[list[float], float]:
    """Prior means for (cos1, sin1, cos2, sin2, ...): a yearly wave of amplitude_pct peaking on
    'peak' (MM-DD); higher harmonics start at 0."""
    s = d["season"]
    amp = _log_pct(float(s["amplitude_pct"]))
    mm, dd = (int(x) for x in s["peak"].split("-"))
    peak_doy = sum((31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[: mm - 1]) + dd
    phase = 2 * math.pi * peak_doy / 365.25
    means = [0.0] * (2 * k_terms)
    if k_terms:
        means[0], means[1] = amp * math.cos(phase), amp * math.sin(phase)
    return means, float(s["sd"])


def national_teams(d: dict, sport: str) -> list[str]:
    return list(d["sports"].get(sport, {}).get("national_teams", []))
