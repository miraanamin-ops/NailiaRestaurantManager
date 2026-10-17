"""Orders, items and payments for each trading day, from the expected orders in demand.py.

Every order is simulated (time, channel, party size, dishes, offer, payment), then
added up. Because the daily, hourly, channel and item totals are all sums of the
same orders, they reconcile exactly.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np

from .deals import slot_matches
from .demand import CHANNELS
from .menu import Menu

# How many dishes of each role go into an order: mean count per person (Poisson),
# or per order when the key ends with "_per_order".
ORDER_RULES = {
    "south_asian": {"main": 0.95, "starter": 0.30, "bread": 1.05, "side": 0.22, "drink": 0.70, "dessert": 0.14, "kids_per_order": 0.12},
    "cafe": {"drink": 1.05, "main": 0.62, "side": 0.10, "dessert": 0.28, "kids_per_order": 0.10},
    "takeaway": {"main": 0.82, "deal": 0.20, "side": 0.75, "drink": 0.40, "dessert": 0.12, "kids_per_order": 0.05},
}
REFUND_RATE = 0.03  # chance a day has one (partial) refund


def day_rng(seed: int, offset: int, d: dt.date, stream: int = 0) -> np.random.Generator:
    """Random numbers for one day: the same seed and day always give the same draws,
    whatever window is generated."""
    return np.random.default_rng([seed, offset, d.toordinal(), stream])


@dataclass
class DayResult:
    day: dt.date
    closed: str | None
    gross: int = 0                    # pence, after discounts and refunds (= sum of item lines)
    discounts: int = 0
    refunds: int = 0
    orders: int = 0
    covers: int = 0
    cash: int = 0
    card: int = 0
    items: dict = field(default_factory=dict)        # dish idx -> [qty, amount after discount]
    hours: dict = field(default_factory=dict)        # till hour index -> [sales, orders, covers]
    channels: dict = field(default_factory=dict)     # (hour index, channel) -> [sales, orders, covers]
    campaign: dict = field(default_factory=dict)     # campaign id -> truth for the day
    receipts: list | None = None                     # order-level detail (export window only)
    refund_line: int = 0


def _people(rng, mean: float, n: int) -> np.ndarray:
    return np.minimum(1 + rng.poisson(max(mean - 1.0, 0.05), n), 12)


def simulate_day(info: dict, menu: Menu, cfg: dict, camps: list[dict], seed: int, keep_receipts: bool) -> DayResult:
    d = info["day"]
    res = DayResult(d, info["closed"], receipts=[] if keep_receipts else None)
    if info["closed"]:
        return res
    rng = day_rng(seed, cfg["seed_offset"], d)
    rules = ORDER_RULES[cfg["menu"]]
    weekend = d.isoweekday() >= 6
    prices = np.array([dish.price_on(d) for dish in menu.dishes], dtype=np.int64)
    weights = np.array([menu.weight(dish, d) for dish in menu.dishes])
    roles = np.array([dish.role for dish in menu.dishes])
    dayparts = np.array([dish.daypart for dish in menu.dishes])
    sections = np.array([dish.section for dish in menu.dishes])
    cash_share = np.interp((d - dt.date(2024, 10, 1)).days, [0, 730], cfg["cash_share"])
    seq = 0
    for h in info["hours"]:
        for ch in CHANNELS:
            lam0 = info["lam"][h][ch]
            camp = next((c for c in camps if slot_matches(c, d, h, ch)), None)
            u = camp["uplift"] if camp else 0.0
            n = int(rng.poisson(lam0 * (1 + u)))
            if n == 0:
                continue
            incr = rng.random(n) < (u / (1 + u))
            mean = cfg["party"]["weekend_dine_in_mean"] if (ch == "dine_in" and weekend) else cfg["party"][f"{ch}_mean"]
            people = _people(rng, mean, n)
            # Which dishes are on offer at this hour (cafe brunch until 12, 15 at weekends; lunch from 11).
            hh = h % 24
            ok = np.ones(len(menu.dishes), dtype=bool)
            ok &= ~((dayparts == "breakfast") & (hh >= (15 if weekend else 12)))
            ok &= ~((dayparts == "lunch") & (hh < 11))
            order_of: list[np.ndarray] = []
            dish_of: list[np.ndarray] = []
            for role, rate in rules.items():
                per_order = role.endswith("_per_order")
                r = role.replace("_per_order", "")
                cand = np.nonzero((roles == r) & ok & (weights > 0))[0]
                if len(cand) == 0:
                    continue
                cnt = rng.poisson(rate * (1 if per_order else people))
                if r == "kids":
                    cnt = np.where(people >= 2, cnt, 0)
                k = int(cnt.sum())
                if k == 0:
                    continue
                w = weights[cand] / weights[cand].sum()
                dish_of.append(rng.choice(cand, size=k, p=w))
                order_of.append(np.repeat(np.arange(n), cnt))
            if not dish_of:
                continue
            od = np.concatenate(order_of)
            di = np.concatenate(dish_of)
            # Every order has at least one item: an order that drew nothing gets its channel's most popular dish.
            empty = np.setdiff1d(np.arange(n), od)
            if len(empty):
                top = int(np.argmax(np.where(ok, weights, 0)))
                od = np.concatenate([od, empty])
                di = np.concatenate([di, np.full(len(empty), top)])
            disc = np.zeros(len(di), dtype=np.int64)
            redeem = np.zeros(n, dtype=bool)
            if camp:
                redeem = incr | (rng.random(n) < camp["redemption"])
                od, di, disc = _apply_offer(camp, od, di, disc, prices, roles, sections, redeem, menu)
            line = prices[di] - disc
            value = np.bincount(od, weights=line, minlength=n).astype(np.int64)
            dval = np.bincount(od, weights=disc, minlength=n).astype(np.int64)
            covers = people if ch == "dine_in" else np.zeros(n, dtype=np.int64)
            uq, inv = np.unique(di, return_inverse=True)
            qty = np.bincount(inv, minlength=len(uq))
            amt = np.bincount(inv, weights=line, minlength=len(uq)).astype(np.int64)
            for j, dish_i in enumerate(uq):
                cur = res.items.setdefault(int(dish_i), [0, 0])
                cur[0] += int(qty[j])
                cur[1] += int(amt[j])
            sales = int(value.sum())
            hs = res.hours.setdefault(h, [0, 0, 0])
            hs[0] += sales; hs[1] += n; hs[2] += int(covers.sum())
            cs = res.channels.setdefault((h, ch), [0, 0, 0])
            cs[0] += sales; cs[1] += n; cs[2] += int(covers.sum())
            res.gross += sales
            res.discounts += int(dval.sum())
            res.orders += n
            res.covers += int(covers.sum())
            if ch == "delivery":
                cash = np.zeros(n, dtype=bool)
            else:
                cash = rng.random(n) < cash_share
            res.cash += int(value[cash].sum())
            res.card += int(value[~cash].sum())
            if camp:
                t = res.campaign.setdefault(camp["id"], {"incremental_orders": 0, "incremental_sales_pence": 0, "incremental_covers": 0,
                                                         "baseline_orders_in_slots": 0, "baseline_discount_pence": 0, "redeemed_orders": 0})
                t["incremental_orders"] += int(incr.sum())
                t["incremental_sales_pence"] += int(value[incr].sum())
                t["incremental_covers"] += int(covers[incr].sum())
                t["baseline_orders_in_slots"] += int((~incr).sum())
                t["baseline_discount_pence"] += int(dval[~incr].sum())
                t["redeemed_orders"] += int(redeem.sum())
            if res.receipts is not None:
                minutes = np.sort(rng.integers(0, 60, n))
                for o in range(n):
                    seq += 1
                    lines = [(int(di[k]), int(prices[di[k]]), int(disc[k])) for k in np.nonzero(od == o)[0]]
                    res.receipts.append({"seq": seq, "hour": h, "minute": int(minutes[o]), "channel": ch, "people": int(people[o]),
                                         "lines": lines, "value": int(value[o]), "discount": int(dval[o]),
                                         "payment": "delivery app" if ch == "delivery" else ("cash" if cash[o] else "card"),
                                         "campaign": camp["id"] if (camp and redeem[o]) else None})
    # Now and then a refund: part of an order given back, a negative line on the till.
    if res.orders and rng.random() < REFUND_RATE:
        r = int(min(res.gross * 0.01, 2500) // 5 * 5) or 500
        res.refunds = r
        res.refund_line = -r
        res.gross -= r
        res.card -= r
        # Booked against the busiest hour and channel, so hours and channel splits still add up to the day.
        (h, ch) = max(res.channels, key=lambda k: res.channels[k][0])
        res.channels[(h, ch)][0] -= r
        res.hours[h][0] -= r
    return res


def _apply_offer(c, od, di, disc, prices, roles, sections, redeem, menu: Menu):
    det = c["details"]
    typ = c["type"]
    red_line = redeem[od]
    if typ == "percent_off":
        secs = det.get("sections")
        elig = red_line & (np.isin(sections[di], secs) if secs else True)
        disc = np.where(elig, (prices[di] * det["discount_percent"] + 50) // 100, disc)
    elif typ == "money_off":
        val = np.bincount(od, weights=prices[di], minlength=len(redeem)).astype(np.int64)
        off = int(det["discount_value_gbp"] * 100)
        mins = int(det["min_order_gbp"] * 100)
        # The £ off comes off each qualifying order's most expensive line.
        order_ok = redeem & (val >= mins)
        for o in np.nonzero(order_ok)[0]:
            idx = np.nonzero(od == o)[0]
            k = idx[np.argmax(prices[di[idx]])]
            disc[k] = min(off, int(prices[di[k]]))
    elif typ == "free_item":
        free = menu.by_name[det["item"]].idx
        orders = np.nonzero(redeem)[0]
        od = np.concatenate([od, orders])
        di = np.concatenate([di, np.full(len(orders), free)])
        disc = np.concatenate([disc, np.full(len(orders), prices[free], dtype=np.int64)])
    elif typ == "two_for_one":
        main_like = np.isin(roles[di], ["main", "drink"] if c["details"]["description"].lower().find("coffee") >= 0 else ["main"])
        for o in np.nonzero(redeem)[0]:
            idx = np.nonzero((od == o) & main_like)[0]
            if len(idx) >= 2:
                k = idx[np.argmin(prices[di[idx]])]
                disc[k] = prices[di[k]]
    elif typ == "kids_eat_free":
        kids = roles[di] == "kids"
        has_main = np.bincount(od, weights=(roles[di] == "main").astype(float), minlength=len(redeem)) > 0
        disc = np.where(kids & red_line & has_main[od], prices[di], disc)
    return od, di, disc
