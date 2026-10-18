"""Sales and covers from the orders forecast.

Sales (net of VAT, pence) = sum over dayparts of orders x spend per order, where
spend per order (channel, daypart, and weekend or weekday) is the median over the
last 8 weeks of that daypart's spend per order on that kind of day (the hourly
channel splits, which include VAT; weekends kept apart because bigger groups spend
more per order on the days with the most orders), times the
median net-to-gross ratio of those weeks (sales_daily), times the price index on
the day over its median in those weeks (so a price rise lifts spend at once).
Dayparts: day (till hours from the trading-day cut-off to 17:00) and evening.
Without hourly splits the day's channel spend is used; without any channel splits,
the day's net sales per order.

Covers = dine-in orders x party size, the median over the last 8 weeks of covers
per dine-in order on the same kind of day (Saturday and Sunday, or weekdays),
where covers are recorded.
"""

from __future__ import annotations

import datetime as dt
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass

WINDOW_DAYS = 56
EVENING_FROM = 17
DAYPARTS = ("day", "evening")


def daypart(hour: int, cutoff_hour: int) -> str:
    return "day" if cutoff_hour <= hour < EVENING_FROM else "evening"


def day_kind(d: dt.date) -> str:
    return "weekend" if d.weekday() >= 5 else "weekday"


@dataclass
class Spend:
    per_order: dict[tuple[str, str, str], float]  # (channel, daypart, weekend/weekday) -> net pence per order (before price adjustment)
    per_part: dict[tuple[str, str], float]  # (channel, daypart), any day
    fallback: dict[str, float]  # channel -> net pence per order for the whole day
    all_per_order: float | None  # net per order, all channels
    net_ratio: float
    base_log_index: float
    party: dict[str, float]  # weekend / weekday -> covers per dine-in order

    def spend(self, channel: str, part: str, log_index: float, kind: str | None = None) -> float | None:
        v = self.per_order.get((channel, part, kind)) if kind else None
        if v is None:
            v = self.per_part.get((channel, part), self.fallback.get(channel))
        if v is None:
            v = self.all_per_order
        if v is None:
            return None
        return v * math.exp(log_index - self.base_log_index)


def spend_model(daily: list[dict], channels: list[dict], channel_hours: list[dict], kt: dt.date, cutoff_hour: int,
                log_index: dict[dt.date, float]) -> Spend:
    since = kt - dt.timedelta(days=WINDOW_DAYS - 1)
    in_window = lambda d: since <= d <= kt  # noqa: E731
    ratios = [r["net_pence"] / r["gross_pence"] for r in daily if in_window(r["day"]) and r.get("net_pence") and r.get("gross_pence")]
    net_ratio = statistics.median(ratios) if ratios else 1 / 1.2
    all_spend = [r["net_pence"] / r["transactions"] for r in daily if in_window(r["day"]) and r.get("net_pence") and r.get("transactions")]

    parts: dict[tuple[str, str, dt.date], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for r in channel_hours:
        if not in_window(r["day"]) or not r.get("orders") or r.get("sales_pence") is None:
            continue
        acc = parts[(r["channel"], daypart(int(r["hour"]), cutoff_hour), r["day"])]
        acc[0] += float(r["sales_pence"]) * (net_ratio if r.get("includes_vat", True) else 1.0)
        acc[1] += float(r["orders"])
    per: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    per_part: dict[tuple[str, str], list[float]] = defaultdict(list)
    for (ch, part, day), (s, n) in parts.items():
        if n:
            per[(ch, part, day_kind(day))].append(s / n)
            per_part[(ch, part)].append(s / n)
    fallback: dict[str, list[float]] = defaultdict(list)
    for r in channels:
        if in_window(r["day"]) and r.get("orders") and r.get("sales_pence") is not None:
            fallback[r["channel"]].append(float(r["sales_pence"]) * (net_ratio if r.get("includes_vat", True) else 1.0) / float(r["orders"]))
    party: dict[str, list[float]] = defaultdict(list)
    for r in channels:
        if r["channel"] == "dine_in" and in_window(r["day"]) and r.get("orders") and r.get("covers") is not None:
            party[day_kind(r["day"])].append(float(r["covers"]) / float(r["orders"]))
    idx = [v for d, v in log_index.items() if in_window(d)]
    return Spend(
        per_order={k: statistics.median(v) for k, v in per.items() if len(v) >= 4},
        per_part={k: statistics.median(v) for k, v in per_part.items() if v},
        fallback={k: statistics.median(v) for k, v in fallback.items() if v},
        all_per_order=statistics.median(all_spend) if all_spend else None,
        net_ratio=net_ratio,
        base_log_index=statistics.median(idx) if idx else 0.0,
        party={k: statistics.median(v) for k, v in party.items() if v},
    )
