"""The restaurant's own actions: deals and menu prices, as known at the issue time.

Deals: one factor per campaign, deal:<campaign id>, 1 on each day it is valid,
on the channels it applies to (all when not said). A deal counts only once it
was sent (sent_at, else its send_at time) by the issue time, so a back-test never
knows about a deal before it went out.

Price index: a fixed-weight index of menu prices,
  index(d) = sum_i w_i p_i(d) / sum_i w_i p_i(base)
with p_i(d) the dish's price on day d from dish_prices recorded by the issue
time (a dish with no price yet takes its first one), w_i the units of the dish
sold up to the last known day, and base the first day of the history.
The factor is log(index); its weight is the price sensitivity (elasticity).
"""

from __future__ import annotations

import bisect
import datetime as dt
import math
from collections import defaultdict

CHANNEL_WORDS = {"dine_in": ("dine", "eat in", "table"), "takeaway": ("takeaway", "collection", "pick"), "delivery": ("delivery",)}


def deal_channels(applies_to: str | None) -> tuple[str, ...] | None:
    """The channels a deal applies to; None = all."""
    if not applies_to:
        return None
    a = applies_to.lower()
    found = tuple(c for c, words in CHANNEL_WORDS.items() if any(w in a for w in words))
    return found or None


def known_deals(deals: list[dict], issue_time: dt.datetime) -> list[dict]:
    out = []
    for d in deals:
        sent = d.get("sent_at") or d.get("send_at")
        if sent is not None and sent <= issue_time and d.get("valid_from") and d.get("valid_until"):
            out.append(d)
    return out


def deal_factors(deals: list[dict], channel: str) -> dict[str, dict[dt.date, float]]:
    out: dict[str, dict[dt.date, float]] = {}
    for d in deals:
        chans = deal_channels(d.get("applies_to"))
        if chans is not None and channel != "all" and channel not in chans:
            continue
        key = f"deal:{d['campaign_id']}"
        day, days = d["valid_from"], {}
        while day <= d["valid_until"]:
            days[day] = 1.0
            day += dt.timedelta(days=1)
        out[key] = days
    return out


class PriceIndex:
    def __init__(self, prices: list[dict], items: list[dict]):
        self.prices = prices
        # Units sold per dish, as running totals by day, so the weights up to any day are one look-up.
        by_dish: dict[str, dict[dt.date, float]] = defaultdict(lambda: defaultdict(float))
        for r in items:
            if r.get("dish_id") and r.get("is_dish", True) is not False:
                by_dish[str(r["dish_id"])][r["day"]] += float(r["quantity"] or 0)
        self._units: dict[str, tuple[list[dt.date], list[float]]] = {}
        for dish, per_day in by_dish.items():
            days = sorted(per_day)
            total, cum = 0.0, []
            for d in days:
                total += per_day[d]
                cum.append(total)
            self._units[dish] = (days, cum)

    def weights(self, known_through: dt.date) -> dict[str, float]:
        out = {}
        for dish, (days, cum) in self._units.items():
            i = bisect.bisect_right(days, known_through)
            if i:
                out[dish] = cum[i - 1]
        return out

    def series(self, days: list[dt.date], issue_time: dt.datetime, known_through: dt.date, base: dt.date) -> dict[dt.date, float]:
        """log(index) for each day, as known at issue_time."""
        weights = self.weights(known_through)
        by_dish: dict[str, list[tuple[dt.date, float]]] = defaultdict(list)
        for p in self.prices:
            if p.get("recorded_at") is not None and p["recorded_at"] > issue_time:
                continue
            by_dish[str(p["dish_id"])].append((p["effective_from"], float(p["price_pence"])))
        dishes = [d for d in weights if d in by_dish and weights[d] > 0]
        if not dishes:
            return {}
        steps = {}
        for d in dishes:
            s = sorted(by_dish[d])
            steps[d] = ([x[0] for x in s], [x[1] for x in s])

        def price(d: str, day: dt.date) -> float:
            eff, val = steps[d]
            i = bisect.bisect_right(eff, day)
            return val[i - 1] if i else val[0]

        base_value = sum(weights[d] * price(d, base) for d in dishes)
        if base_value <= 0:
            return {}
        # The index only moves on a price change: work it out there and carry it forward.
        changes = sorted({e for d in dishes for e in steps[d][0]})
        at = [(c, math.log(sum(weights[d] * price(d, c) for d in dishes) / base_value)) for c in changes]
        when = [c for c, _ in at]
        out = {}
        for day in days:
            i = bisect.bisect_right(when, day)
            out[day] = at[i - 1][1] if i else math.log(sum(weights[d] * price(d, day) for d in dishes) / base_value)
        return out
