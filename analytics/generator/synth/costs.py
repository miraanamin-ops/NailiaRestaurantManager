"""Ingredient use, stock, supplier invoices, ingredient prices, fixed costs, targets and channel fees.

What a restaurant buys = what its recipes used (plus prep waste) + spoilage + the
change in stock. Each supplier delivers once a week; the order tops stock up to
about 9 days of last week's use, in whole packs. If stock runs out mid-week there
is an extra cash and carry run. Ground truth keeps use, waste and stock per
ingredient so the identity can be checked exactly.
"""

from __future__ import annotations

import datetime as dt
import math

import numpy as np

from .ids import uid
from .menu import OPENED
from .menus import INFLATION, PRICE_JUMPS, PRICE_LEVEL

TARGET_DAYS = 9          # stock after a delivery covers about this many days of recent use
PRICE_REVIEW_WEEKS = (4, 9)  # suppliers change a price every 4 to 9 weeks


class Costs:
    def __init__(self, sim, seed: int):
        self.sim, self.cfg = sim, sim.cfg
        self.rng = np.random.default_rng([seed, self.cfg["seed_offset"], 11])
        key = self.cfg["key"]
        self.supplier_ids = {k: uid(key, "supplier", k) for k in sim.menu.suppliers}
        self.ing_ids = {k: uid(key, "ingredient", k) for k in sim.menu.ingredients}
        self._price_paths()
        self.use = self._use()
        self.invoices, self.lines, self.price_rows = [], [], []
        self.stock_open, self.stock_close, self.waste, self.bought = {}, {}, {}, {}
        self._buy()

    # Pack prices over time: inflation per category, one-off jumps, changed at supplier price reviews.
    def _price_paths(self):
        self.path: dict[str, list[tuple[dt.date, int]]] = {}
        for k, (name, unit, cat, pack, price, sup, spoil, desc, vat) in self.sim.menu.ingredients.items():
            d, pts = OPENED, []
            noise = 1.0
            while d <= self.sim.end + dt.timedelta(days=60):
                yrs = (d - OPENED).days / 365.25
                f = (1 + INFLATION[cat]) ** yrs
                for jd, jc, jf in PRICE_JUMPS:
                    if jc == cat and dt.date.fromisoformat(jd) <= d:
                        f *= jf
                noise = float(np.clip(noise * math.exp(self.rng.normal(0, 0.015)), 0.94, 1.06))
                pts.append((d, int(round(price * PRICE_LEVEL[self.cfg["menu"]] * f * noise / 5.0) * 5)))
                d += dt.timedelta(weeks=int(self.rng.integers(PRICE_REVIEW_WEEKS[0], PRICE_REVIEW_WEEKS[1] + 1)))
            self.path[k] = pts

    def pack_price(self, k: str, d: dt.date) -> int:
        p = self.path[k][0][1]
        for f, v in self.path[k]:
            if f <= d:
                p = v
        return p

    def unit_cost(self, k: str, d: dt.date) -> float:
        return self.pack_price(k, d) / self.sim.menu.ingredients[k][3]

    def _use(self) -> dict[dt.date, dict[str, float]]:
        """Ingredient used per trading day (recipe quantity / (1 - prep waste)), from the items sold."""
        menu = self.sim.menu
        out = {}
        self.prep_waste = {}
        for res in self.sim.results:
            u: dict[str, float] = {}
            for di, (qty, _amt) in res.items.items():
                for ing, q, w in menu.dishes[di].recipe:
                    gross = q * qty / (1 - w / 100.0)
                    u[ing] = u.get(ing, 0.0) + gross
                    self.prep_waste[ing] = self.prep_waste.get(ing, 0.0) + gross - q * qty
            out[res.day] = u
        return out

    def dish_cost(self, dish, d: dt.date) -> float:
        """True food cost of one portion on a day, in pence (recipe incl. prep waste x unit cost)."""
        return sum(q / (1 - w / 100.0) * self.unit_cost(ing, d) for ing, q, w in dish.recipe)

    def _buy(self):
        sim, ings = self.sim, self.sim.menu.ingredients
        days = [r.day for r in sim.results]
        first_week = days[:7]
        stock = {}
        for k in ings:
            wk = sum(self.use[d].get(k, 0.0) for d in first_week)
            stock[k] = wk  # opening stock: about a week's use
        self.stock_open = {k: round(v, 3) for k, v in stock.items()}
        recent: dict[str, list[float]] = {k: [] for k in ings}
        inv_no = {s: 10000 + 137 * i for i, s in enumerate(self.supplier_ids)}
        for d in days:
            # Deliveries arrive in the morning, before trading.
            for skey, (sname, scat, wday) in sim.menu.suppliers.items():
                if d.isoweekday() != wday:
                    continue
                lines = []
                for k, (name, unit, cat, pack, price, sup, spoil, desc, vat) in ings.items():
                    if sup != skey:
                        continue
                    last7 = sum(recent[k][-7:]) if recent[k] else sum(self.use[x].get(k, 0.0) for x in first_week)
                    need = last7 / 7.0 * TARGET_DAYS - stock[k]
                    if need <= 0:
                        continue
                    packs = math.ceil(need / pack)
                    lines.append((k, packs))
                if lines:
                    self._invoice(skey, d, lines, inv_no, stock)
            # Trading: use, then spoilage of a share of what came in (perishables).
            for k in ings:
                u = self.use[d].get(k, 0.0)
                if stock[k] < u:
                    # Ran out: an extra cash and carry run that morning.
                    packs = math.ceil((u - stock[k]) / ings[k][3]) + 1
                    self._invoice("cash" if "cash" in sim.menu.suppliers else next(iter(sim.menu.suppliers)), d, [(k, packs)], inv_no, stock, emergency=True)
                stock[k] -= u
                recent[k].append(u)
        self.stock_close = {k: round(v, 3) for k, v in stock.items()}

    def _invoice(self, skey, d, lines, inv_no, stock, emergency=False):
        ings = self.sim.menu.ingredients
        inv_no[skey] += 1
        inv_id = uid(self.cfg["key"], "invoice", skey, d, inv_no[skey])
        net = vat_total = 0
        for pos, (k, packs) in enumerate(lines):
            name, unit, cat, pack, price, sup, spoil, desc, vat = ings[k]
            pp = self.pack_price(k, d)
            qty = packs * pack
            spoiled = qty * spoil / 100.0
            stock[k] += qty - spoiled
            self.waste[k] = self.waste.get(k, 0.0) + spoiled
            self.bought[k] = self.bought.get(k, 0.0) + qty
            line_net = packs * pp
            line_vat = int(round(line_net * vat / 100))
            net += line_net
            vat_total += line_vat
            line_id = uid(self.cfg["key"], "invoice-line", inv_id, pos)
            self.lines.append({"id": line_id, "invoice": inv_id, "position": pos, "ingredient": k, "description": desc,
                               "quantity": packs, "unit_text": "case" if unit == "each" else "x " + desc.split()[-1],
                               "quantity_std": qty, "net": line_net, "vat": line_vat})
            last = next((r for r in reversed(self.price_rows) if r["ingredient"] == k), None)
            if last is None or last["pence"] != pp:
                self.price_rows.append({"id": uid(self.cfg["key"], "ingredient-price", k, d), "ingredient": k, "pence": pp, "pack": pack,
                                        "from": d, "supplier": skey, "line": line_id})
        self.invoices.append({"id": inv_id, "supplier": skey, "number": f"{skey[:3].upper()}-{inv_no[skey]}", "date": d,
                              "net": net, "vat": vat_total, "gross": net + vat_total, "emergency": emergency})

    # Fixed costs, targets and channel fees (plain lists of rows).
    def fixed_costs(self) -> list[dict]:
        base = {"south_asian": 420000, "cafe": 310000, "takeaway": 360000}[self.cfg["menu"]]
        rows = [
            ("Rent", "rent", base, "monthly", OPENED, None),
            ("Business rates", "business_rates", int(base * 0.22), "monthly", OPENED, dt.date(2025, 4, 1)),
            ("Business rates", "business_rates", int(base * 0.24), "monthly", dt.date(2025, 4, 1), None),
            ("Electricity and gas", "utilities", int(base * 0.33), "monthly", OPENED, dt.date(2025, 4, 1)),
            ("Electricity and gas", "utilities", int(base * 0.29), "monthly", dt.date(2025, 4, 1), None),
            ("Water", "utilities", 18000, "monthly", OPENED, None),
            ("Insurance", "insurance", 285000, "yearly", OPENED, None),
            ("Till and card machine", "subscriptions", 7900, "monthly", OPENED, None),
            ("Accounting software", "subscriptions", 3300, "monthly", OPENED, None),
            ("Music licence", "subscriptions", 62000, "yearly", OPENED, None),
            ("Waste collection", "other", 21000, "monthly", OPENED, None),
        ]
        if self.cfg["menu"] == "cafe":
            rows.append(("Refit loan", "loan", 65000, "monthly", OPENED, dt.date(2026, 4, 1)))
        if self.cfg["menu"] == "takeaway":
            rows.append(("Delivery tablet and website", "subscriptions", 4900, "monthly", OPENED, None))
        return [{"id": uid(self.cfg["key"], "fixed", n, f), "name": n, "category": c, "pence": p, "frequency": fr, "from": f, "to": t}
                for n, c, p, fr, f, t in rows]

    def targets(self) -> list[dict]:
        t = {"south_asian": (28, 30, 60), "cafe": (32, 27, 60), "takeaway": (24, 32, 58)}[self.cfg["menu"]]
        weekly = {"south_asian": 2400000, "cafe": 1250000, "takeaway": 2000000}[self.cfg["menu"]]
        rows = [("labour_pct", t[0], OPENED), ("food_cost_pct", t[1], OPENED), ("prime_cost_pct", t[2], OPENED),
                ("weekly_sales_pence", weekly, OPENED), ("weekly_sales_pence", int(weekly * 1.08), dt.date(2026, 1, 1))]
        return [{"id": uid(self.cfg["key"], "target", m, f), "metric": m, "value": v, "from": f} for m, v, f in rows]

    def channel_fees(self) -> list[dict]:
        rows = [("delivery", 30.0, 0, OPENED, dt.date(2025, 7, 1), "Deliveroo and Uber Eats, marketplace plan"),
                ("delivery", 32.0, 0, dt.date(2025, 7, 1), None, "Deliveroo and Uber Eats, marketplace plan (fee rise)")]
        if self.cfg["menu"] == "takeaway":
            rows.append(("takeaway", 0.0, 20, OPENED, None, "Own website ordering, 20p per order"))
        return [{"id": uid(self.cfg["key"], "fee", ch, f), "channel": ch, "pct": p, "per_order": po, "from": f, "to": t, "notes": n}
                for ch, p, po, f, t, n in rows]
