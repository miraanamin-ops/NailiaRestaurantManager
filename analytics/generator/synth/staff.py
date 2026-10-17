"""Staff, pay, availability, time off, cover rules, planned rotas and the hours really worked.

Rotas are planned from expected demand (no campaigns, no surprises). Actual hours
differ: people start a few minutes late, stay on when the day is busier than
expected and are sent home early when it is quiet; sick days are covered or left
short. A few UK working-time edge cases are planted on purpose (ground truth lists them).
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import numpy as np

from .ids import uid
from .menu import OPENED
from .timeutil import LONDON, UTC

DATA = Path(__file__).resolve().parent / "outside" / "data"

# (display name, roles, skills, contracted hours a week (None = zero hours), age band,
#  pay above the band's minimum in pence, employment start (None = before the window), end)
ROSTERS = {
    "south_asian": [
        ("Imran", ["chef", "manager"], ["tandoor", "curry", "grill"], 55, "21_plus", 520, None, None),
        ("Farhan", ["chef"], ["curry", "biryani"], 45, "21_plus", 260, None, None),
        ("Rakesh", ["chef"], ["tandoor", "grill"], 40, "21_plus", 220, None, None),
        ("Tariq", ["chef"], ["curry"], 30, "21_plus", 120, "2025-06-02", None),
        ("Yusuf", ["kitchen porter"], [], 30, "18_20", 0, None, None),
        ("Danny", ["kitchen porter"], [], None, "21_plus", 0, None, None),
        ("Aisha", ["manager", "front"], ["till", "bookings"], 45, "21_plus", 330, None, None),
        ("Sana", ["front"], ["till"], 35, "21_plus", 40, None, "2025-09-30"),
        ("Mariam", ["front"], ["till"], 30, "21_plus", 40, "2025-09-15", None),
        ("Zain", ["front", "counter"], [], None, "18_20", 0, None, None),
        ("Hamza", ["front", "counter"], [], None, "under_18", 0, None, None),
        ("Leila", ["front"], [], 20, "21_plus", 20, None, None),
        ("Omar", ["counter"], ["till"], 30, "21_plus", 20, None, None),
        ("Nadia", ["front"], [], 25, "21_plus", 20, None, None),
        ("Bilal", ["front", "counter"], [], None, "21_plus", 0, "2025-03-03", None),
    ],
    "cafe": [
        ("Nell", ["manager", "front"], ["barista", "till"], 40, "21_plus", 280, None, None),
        ("Tom", ["chef"], ["brunch", "grill"], 40, "21_plus", 240, None, None),
        ("Priya", ["chef"], ["brunch"], 30, "21_plus", 120, None, None),
        ("Kasia", ["barista"], ["latte art"], 35, "21_plus", 60, None, None),
        ("Jordan", ["barista", "front"], [], None, "18_20", 0, None, None),
        ("Ella", ["front"], ["till"], 25, "21_plus", 20, None, "2025-12-31"),
        ("Ruby", ["front"], [], None, "under_18", 0, None, None),
        ("Marcus", ["front", "barista"], [], 25, "apprentice", 0, "2025-01-06", None),
        ("Ade", ["kitchen porter"], [], 20, "21_plus", 0, None, None),
        ("Sofia", ["front"], ["till"], 25, "21_plus", 20, "2026-01-05", None),
        ("Hana", ["front", "barista"], [], 30, "21_plus", 20, None, None),
        ("Ollie", ["chef"], ["brunch"], None, "18_20", 0, None, None),
    ],
    "takeaway": [
        ("Karim", ["manager", "chef"], ["grill", "pizza"], 50, "21_plus", 380, None, None),
        ("Bogdan", ["chef"], ["grill"], 45, "21_plus", 200, None, None),
        ("Ravi", ["chef"], ["pizza"], 40, "21_plus", 160, None, None),
        ("Luca", ["chef"], ["pizza", "grill"], None, "21_plus", 80, None, None),
        ("Abdi", ["counter"], ["till"], 40, "21_plus", 40, None, None),
        ("Jess", ["counter"], ["till"], 25, "18_20", 0, None, None),
        ("Kofi", ["counter"], [], None, "18_20", 0, None, "2026-02-27"),
        ("Ilyas", ["counter"], [], None, "under_18", 0, None, None),
        ("Dev", ["kitchen porter"], [], 30, "21_plus", 0, None, None),
        ("Sami", ["kitchen porter", "counter"], [], None, "18_20", 0, "2026-03-02", None),
        ("Marta", ["counter"], ["till"], 20, "21_plus", 20, "2025-04-07", None),
        ("Hassan", ["chef"], ["grill"], 35, "21_plus", 120, None, None),
        ("Precious", ["counter", "manager"], ["till"], 30, "21_plus", 140, None, None),
    ],
}

# Shift templates: (role, start hour, end hour or "close+x", base count, scale on, orders per extra person, max, weekdays)
#   scale on: "lunch" (expected orders before 17:00), "evening" (from 17:00), "day" (all), None
TEMPLATES = {
    "south_asian": [
        ("chef", 11.0, 17.0, 1, None, 0, 1, range(1, 8)),
        ("chef", 16.0, "close+0.5", 1, "evening", 55, 3, range(1, 8)),
        ("kitchen porter", 17.0, "close+0.5", 1, "evening", 110, 2, range(1, 8)),
        ("front", 11.5, 16.0, 1, "lunch", 30, 2, range(1, 8)),
        ("front", 17.0, "close+0.5", 1, "evening", 28, 4, range(1, 8)),
        ("manager", 15.0, "close+0.5", 1, None, 0, 1, range(1, 8)),
        ("counter", 17.0, "close", 1, None, 0, 1, range(1, 8)),
    ],
    "cafe": [
        ("chef", 7.5, 15.5, 1, "day", 70, 3, range(1, 8)),
        ("barista", 7.5, 15.0, 1, "day", 95, 2, range(1, 8)),
        ("front", 7.5, 13.0, 1, "day", 60, 3, range(1, 8)),
        ("front", 12.0, "close+0.5", 1, "day", 90, 2, range(1, 8)),
        ("kitchen porter", 10.0, "close", 1, None, 0, 1, range(5, 8)),
        ("manager", 8.0, 16.5, 1, None, 0, 1, range(1, 6)),
    ],
    "takeaway": [
        ("chef", 15.5, "close+0.5", 1, "evening", 45, 3, range(1, 8)),
        ("counter", 15.5, "close+0.5", 1, "evening", 75, 3, range(1, 8)),
        ("kitchen porter", 18.0, "close+0.5", 1, None, 0, 1, range(5, 8)),
        ("manager", 16.0, "close", 1, None, 0, 1, range(1, 8)),
    ],
}

PAY_RAISE = 0.04          # yearly raise each April for staff paid above the minimum
SICK_DAYS_PER_YEAR = 4.0
HOLIDAY_WEEKS_PER_YEAR = 2


def min_wage(band: str, d: dt.date) -> int:
    rates = json.loads((DATA / "min_wage.json").read_text())["rates"]
    cur = rates[0]
    for r in rates:
        if dt.date.fromisoformat(r["from"]) <= d:
            cur = r
    return cur[band]


def _ts(d: dt.date, hour: float) -> dt.datetime:
    """UTC instant of `hour` hours (may pass 24) from the London midnight starting trading day d."""
    day = d + dt.timedelta(days=int(hour // 24))
    h = hour % 24
    hh, mm = int(h), int(round((h - int(h)) * 60))
    return dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=LONDON).astimezone(UTC)


class Staffing:
    def __init__(self, sim, seed: int):
        self.sim, self.cfg = sim, sim.cfg
        key = self.cfg["key"]
        rng = np.random.default_rng([seed, self.cfg["seed_offset"], 7])
        self.rng = rng
        self.staff = []
        for i, (name, roles, skills, hours, band, prem, start, end) in enumerate(ROSTERS[self.cfg["menu"]]):
            s = {"id": uid(key, "staff", name), "name": name, "roles": roles, "skills": skills, "contracted": hours, "band": band,
                 "premium": prem, "start": dt.date.fromisoformat(start) if start else OPENED,
                 "end": dt.date.fromisoformat(end) if end else None}
            self.staff.append(s)
        self.pay = self._pay()
        self.availability = self._availability()
        self.time_off = self._time_off()
        self.cover_rules = self._cover_rules()
        self.shifts, self.actuals, self.edge_cases = [], [], []
        self.weeks = []
        self._rota()

    # Pay: the band's minimum plus a premium; a new rate each April (minimum wage changes, raises).
    def _pay(self):
        rows = []
        for s in self.staff:
            first = max(s["start"], OPENED)
            rate = min_wage(s["band"], first) + s["premium"]
            rows.append({"staff": s["id"], "from": first, "pence": rate})
            for y in (2025, 2026):
                d = dt.date(y, 4, 1)
                if d <= first or (s["end"] and d > s["end"]):
                    continue
                rate = max(min_wage(s["band"], d) + s["premium"], int(round(rate * (1 + PAY_RAISE)))) if s["premium"] else min_wage(s["band"], d)
                rows.append({"staff": s["id"], "from": d, "pence": rate})
        return rows

    def rate_on(self, staff_id: str, d: dt.date) -> int:
        r = None
        for p in self.pay:
            if p["staff"] == staff_id and p["from"] <= d:
                r = p["pence"]
        return r

    def _availability(self):
        rows = []
        for i, s in enumerate(self.staff):
            off = 1 + (i * 3) % 7  # a regular day off for full-timers
            for wd in range(1, 8):
                if s["band"] == "under_18":
                    if wd <= 5:
                        rows.append((s["id"], wd, "17:00", "22:00", "available"))
                    else:
                        rows.append((s["id"], wd, "10:00", "22:00", "available"))
                elif s["contracted"] and s["contracted"] >= 35 and wd == off:
                    rows.append((s["id"], wd, "00:00", "23:59", "unavailable"))
                else:
                    rows.append((s["id"], wd, "07:00", "03:00", "available"))
        return [{"staff": a, "weekday": b, "starts": c, "ends": d, "kind": k} for a, b, c, d, k in rows]

    def _available(self, s, d: dt.date, start: float, end: float) -> bool:
        for a in self.availability:
            if a["staff"] != s["id"] or a["weekday"] != d.isoweekday():
                continue
            if a["kind"] == "unavailable":
                return False
            sh = int(a["starts"][:2])
            eh = int(a["ends"][:2]) + (24 if a["ends"] <= a["starts"] else 0)
            return sh <= start and end <= eh + (1 if eh == 22 else 0)
        return False

    def _time_off(self):
        rng = self.rng
        rows = []
        start, end = self.sim.start, self.sim.end
        for s in self.staff:
            a = max(start, s["start"])
            b = min(end, s["end"]) if s["end"] else end
            if b <= a:
                continue
            span = (b - a).days
            if s["contracted"]:
                for k in range(int(HOLIDAY_WEEKS_PER_YEAR * span / 365)):
                    st = a + dt.timedelta(days=int(rng.integers(0, max(1, span - 7))))
                    rows.append({"staff": s["id"], "start": st, "end": st + dt.timedelta(days=7), "kind": "holiday",
                                 "status": "approved"})
            for _ in range(int(rng.poisson(SICK_DAYS_PER_YEAR * span / 365))):
                st = a + dt.timedelta(days=int(rng.integers(0, span)))
                rows.append({"staff": s["id"], "start": st, "end": st + dt.timedelta(days=1), "kind": "sick", "status": "approved"})
        # A request that was declined, and one still waiting.
        if rows:
            rows[0] = dict(rows[0], status="declined") if rows[0]["kind"] == "holiday" else rows[0]
        rows.append({"staff": self.staff[-1]["id"], "start": end + dt.timedelta(days=20), "end": end + dt.timedelta(days=27), "kind": "holiday", "status": "requested"})
        return rows

    def _off(self, s, d: dt.date) -> str | None:
        for t in self.time_off:
            if t["staff"] == s["id"] and t["status"] == "approved" and t["start"] <= d < t["end"]:
                return t["kind"]
        return None

    def _cover_rules(self):
        rows = []
        for role, st, en, base, scale, per, mx, wds in TEMPLATES[self.cfg["menu"]]:
            close = max(c for _, c in self.cfg["hours"].values())
            e = close + float(en.split("+")[1]) if isinstance(en, str) and "+" in en else close if en == "close" else en
            cps = round(per * 0.9, 1) if (role == "front" and per) else None
            for wd in (wds if len(wds) < 7 else [None]):
                rows.append({"role": role, "weekday": wd, "starts": _hhmm(st), "ends": _hhmm(e % 24), "min_staff": base, "covers_per_staff": cps})
        return rows

    def _rota(self):
        sim, cfg, rng = self.sim, self.cfg, self.rng
        temps = TEMPLATES[cfg["menu"]]
        week_hours: dict[tuple, float] = {}
        last_end: dict[str, dt.datetime] = {}
        info_by_day = {i["day"]: (i, r) for i, r in zip(sim.days, sim.results)}
        d = sim.start - dt.timedelta(days=sim.start.isoweekday() - 1)
        while d <= sim.end:
            self.weeks.append(d)
            d += dt.timedelta(days=7)
        for info, res in zip(sim.days, sim.results):
            day = info["day"]
            if info["closed"]:
                continue
            o, c = cfg["hours"][day.isoweekday()]
            hours = info["hours"]
            close = hours[-1] + 1 if hours else c
            exp = {"lunch": 0.0, "evening": 0.0, "day": 0.0}
            for h in hours:
                tot = sum(info["lam"][h].values())
                exp["day"] += tot
                exp["evening" if h >= 17 else "lunch"] += tot
            expected_orders = exp["day"]
            surprise = res.orders / expected_orders if expected_orders else 1.0
            week = day - dt.timedelta(days=day.isoweekday() - 1)
            # Managers first: they also cover other roles, so their own shift must be filled before they are used elsewhere.
            for t_i, (role, st, en, base, scale, per, mx, wds) in sorted(enumerate(temps), key=lambda x: x[1][0] != "manager"):
                if day.isoweekday() not in wds:
                    continue
                start = min(st, o - 0.5) if st <= o else st
                end = close + float(en.split("+")[1]) if isinstance(en, str) and "+" in en else close if en == "close" else en
                n = base
                if scale and per:
                    n = min(mx, base + int(exp[scale] // per))
                for k in range(n):
                    sid = self._pick(role, day, start, end, week, week_hours)
                    sh = {"id": uid(cfg["key"], "shift", day, t_i, k), "week": week, "staff": sid, "role": role, "day": day,
                          "start": _ts(day, start), "end": _ts(day, end),
                          "break": 30 if end - start > 6 else 0}
                    self.shifts.append(sh)
                    if sid:
                        week_hours[(sid, week)] = week_hours.get((sid, week), 0.0) + (end - start)
                    self._actual(sh, day, surprise, rng, week, week_hours, last_end)
        self._plant_edge_cases()

    def _pick(self, role, day, start, end, week, week_hours):
        best, best_h = None, 1e9
        for s in self.staff:
            if role not in s["roles"] or day < s["start"] or (s["end"] and day > s["end"]):
                continue
            if self._off(s, day) or not self._available(s, day, start, end):
                continue
            if any(x["staff"] == s["id"] and x["day"] == day for x in self.shifts[-12:]):
                continue
            h = week_hours.get((s["id"], week), 0.0)
            cap = (s["contracted"] or 30) + 8
            if h + (end - start) > cap:
                continue
            score = h - (s["contracted"] or 0) * 0.5 - (5 if role in ("manager",) and "manager" in s["roles"][:1] else 0)
            if score < best_h:
                best, best_h = s["id"], score
        return best

    def _actual(self, sh, day, surprise, rng, week, week_hours, last_end):
        if not sh["staff"]:
            return
        s = next(x for x in self.staff if x["id"] == sh["staff"])
        sick_today = any(t["staff"] == s["id"] and t["kind"] == "sick" and t["start"] == day for t in self.time_off)
        if sick_today:
            return
        late = int(max(-5, rng.normal(2, 4)))
        start = sh["start"] + dt.timedelta(minutes=late)
        over = 60 * (surprise - 1.0) * 1.2 + rng.normal(0, 8)
        if surprise < 0.8 and sh["role"] in ("front", "counter") and rng.random() < 0.5:
            over -= rng.integers(30, 91)  # sent home early on a quiet day
        end = sh["end"] + dt.timedelta(minutes=int(round(over)))
        if end <= start + dt.timedelta(hours=1):
            end = start + dt.timedelta(hours=1)
        self.actuals.append({"id": uid(self.cfg["key"], "actual", sh["id"]), "staff": s["id"], "shift": sh["id"], "role": sh["role"],
                             "day": day, "start": start, "end": end, "break": sh["break"], "source": "manual"})

    def _plant_edge_cases(self):
        """Working-time cases a rota checker should catch (listed in ground truth)."""
        acts = self.actuals
        by_staff = {s["id"]: s for s in self.staff}
        # 1. An under-18 working more than 8 hours in a day.
        for a in acts:
            if by_staff[a["staff"]]["band"] == "under_18" and a["day"].isoweekday() >= 6:
                a["start"] = a["end"] - dt.timedelta(hours=9)
                a["break"] = 30
                self.edge_cases.append({"case": "under_18_over_8_hours", "staff": a["staff"], "day": a["day"].isoformat(), "paid_hours": 8.5})
                break
        # 2. Less than 11 hours' rest: closing then opening the next morning.
        ids = [a for a in acts if "manager" in by_staff[a["staff"]]["roles"] and a["end"].astimezone(LONDON).hour < 3]
        for a in ids[len(ids) // 3: len(ids) // 3 + 1]:
            nxt = a["day"] + dt.timedelta(days=1)
            st = a["end"] + dt.timedelta(hours=10)
            self.actuals.append({"id": uid(self.cfg["key"], "actual-clopen", a["id"]), "staff": a["staff"], "shift": None, "role": a["role"],
                                 "day": nxt, "start": st, "end": st + dt.timedelta(hours=5), "break": 0, "source": "manual"})
            self.edge_cases.append({"case": "rest_under_11_hours", "staff": a["staff"], "day": nxt.isoformat(), "rest_hours": 10})
        # 3. A long shift with no break.
        for a in acts[len(acts) // 2:]:
            if (a["end"] - a["start"]).total_seconds() > 7 * 3600 and a["break"]:
                a["break"] = 0
                self.edge_cases.append({"case": "no_break_over_6_hours", "staff": a["staff"], "day": a["day"].isoformat()})
                break
        # 4. Shifts across the October clock change (the night has an extra hour): flagged only.
        for a in acts:
            loc_s, loc_e = a["start"].astimezone(LONDON), a["end"].astimezone(LONDON)
            if loc_s.utcoffset() != loc_e.utcoffset():
                self.edge_cases.append({"case": "shift_across_clock_change", "staff": a["staff"], "day": a["day"].isoformat(),
                                        "wall_clock_hours": round(((loc_e.replace(tzinfo=None) - loc_s.replace(tzinfo=None)).total_seconds()) / 3600, 2),
                                        "real_hours": round((a["end"] - a["start"]).total_seconds() / 3600, 2)})
        # 5. Over 48 hours a week (the head chef, who would need an opt-out).
        weekly: dict[tuple, float] = {}
        for a in self.actuals:
            k = (a["staff"], a["day"] - dt.timedelta(days=a["day"].isoweekday() - 1))
            weekly[k] = weekly.get(k, 0.0) + ((a["end"] - a["start"]).total_seconds() / 60 - a["break"]) / 60
        over = sorted({k[0] for k, v in weekly.items() if v > 48})
        for sid in over:
            self.edge_cases.append({"case": "over_48_hours_some_weeks", "staff": sid, "weeks": sum(1 for k, v in weekly.items() if k[0] == sid and v > 48)})

    def labour_cost(self) -> dict:
        """Pence per actual shift, and per week (paid minutes x the pay rate on the day)."""
        per_shift, per_week = {}, {}
        for a in self.actuals:
            paid = (a["end"] - a["start"]).total_seconds() / 60 - a["break"]
            cost = paid * self.rate_on(a["staff"], a["day"]) / 60.0
            per_shift[a["id"]] = round(cost, 4)
            wk = (a["day"] - dt.timedelta(days=a["day"].isoweekday() - 1)).isoformat()
            per_week[wk] = per_week.get(wk, 0.0) + cost
        return {"per_shift": per_shift, "per_week": {k: round(v, 2) for k, v in sorted(per_week.items())}}


def _hhmm(h: float) -> str:
    h = h % 24
    return f"{int(h):02d}:{int(round((h - int(h)) * 60)):02d}"
