"""The menu over time: dishes with ids, prices (with every rise), till names, recipes,
and how likely each dish is to be picked on a day."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from .ids import uid
from .menus import MENUS

# The demo restaurants have traded since before any window: first prices are from this day.
OPENED = dt.date(2023, 6, 1)


@dataclass
class Dish:
    idx: int
    id: str
    section: str
    name: str
    till_name: str
    role: str
    daypart: str
    popularity: float
    recipe: list
    prices: list = field(default_factory=list)  # [(effective_from, pence)], first one from the start
    active_from: dt.date | None = None
    ramp_days: int = 0
    cannibalises: str | None = None
    cannibal_share: float = 0.0

    def price_on(self, d: dt.date) -> int:
        p = self.prices[0][1]
        for f, v in self.prices:
            if f <= d:
                p = v
        return p


class Menu:
    def __init__(self, cfg: dict, start: dt.date):
        suppliers, ingredients, dishes, new = MENUS[cfg["menu"]]
        self.cfg, self.start = cfg, start
        self.suppliers = suppliers
        self.ingredients = ingredients
        self.sections: list[str] = []
        self.dishes: list[Dish] = []
        rows = list(dishes)
        launches = {n["name"]: n for n in cfg["new_dishes"]}
        for name in launches:
            rows.append(new[name])
        for sec, name, price, till, role, daypart, pop, recipe in rows:
            if sec not in self.sections:
                self.sections.append(sec)
            d = Dish(len(self.dishes), uid(cfg["key"], "dish", name), sec, name, till, role, daypart, float(pop), recipe)
            d.prices = [(OPENED, price)]
            if name in launches:
                n = launches[name]
                d.active_from = dt.date.fromisoformat(n["launch"])
                d.prices = [(d.active_from, price)]
                d.ramp_days = n["ramp_days"]
                d.cannibalises = n["cannibalises"]
                d.cannibal_share = n["share"]
            self.dishes.append(d)
        # Price rises: whole menu sections, rounded to the nearest 5p.
        for r in cfg["price_rises"]:
            day = dt.date.fromisoformat(r["day"])
            for d in self.dishes:
                if d.section in r["sections"] and (d.active_from is None or d.active_from <= day):
                    old = d.price_on(day)
                    d.prices.append((day, int(round(old * (1 + r["pct"]) / 5.0) * 5)))
        for d in self.dishes:
            d.prices.sort()
        self.by_name = {d.name: d for d in self.dishes}
        self._weights_total0 = sum(d.popularity for d in self.dishes if d.active_from is None)

    def active(self, d: Dish, day: dt.date) -> bool:
        return d.active_from is None or d.active_from <= day

    def ramp(self, d: Dish, day: dt.date) -> float:
        if d.active_from is None:
            return 1.0
        if day < d.active_from:
            return 0.0
        return min(1.0, ((day - d.active_from).days + 1) / max(1, d.ramp_days))

    def weight(self, d: Dish, day: dt.date) -> float:
        """Pick weight on a day: popularity x price effect x launch ramp, less what a new dish takes."""
        if not self.active(d, day):
            return 0.0
        w = d.popularity * (d.price_on(day) / d.prices[0][1]) ** self.cfg["elasticity"] * self.ramp(d, day)
        for n in self.dishes:
            if n.cannibalises == d.name and self.active(n, day):
                w *= 1 - n.cannibal_share * self.ramp(n, day)
        return w

    def price_index(self, day: dt.date) -> float:
        """Popularity-weighted menu price compared with the start of the window (dishes on the menu from the start)."""
        base = [d for d in self.dishes if d.active_from is None]
        return sum(d.popularity * d.price_on(day) / d.prices[0][1] for d in base) / self._weights_total0
