"""Expected orders per trading day, till hour and channel, with every effect recorded.

expected orders(day, hour, channel) =
    base x trend x day of week x season x noise x shock x unexplained
    x bank holiday x Christmas/New Year x Ramadan/Eid x school holiday x payday
    x price index ^ order elasticity
    x channel share x weather(channel)
    x hour profile (with Jummah, Ramadan iftar and late peak, school-holiday lunch)
  + extra orders from football and venue events, placed in the hours around them
Campaign uplift is applied separately (lambda_with = lambda_without x (1 + uplift)),
so the true effect of each deal is known exactly (see sales.py).
"""

from __future__ import annotations

import datetime as dt
import math

import numpy as np

from .outside.calendar import distance_m, event_days
from .timeutil import LONDON, UTC, days

CHANNELS = ("dine_in", "takeaway", "delivery")


class Demand:
    def __init__(self, cfg: dict, start: dt.date, end: dt.date, events: list[dict], prayer: dict, wh, wd, sun_normal: dict,
                 menu, rng: np.random.Generator):
        self.cfg, self.start, self.end, self.events, self.prayer = cfg, start, end, events, prayer
        self.wh, self.wd, self.sun_normal, self.menu, self.rng = wh, wd, sun_normal, menu, rng
        self.lat, self.lon = None, None
        self.by_day: dict[dt.date, list[dict]] = {}
        for e in events:
            for d in event_days(e):
                self.by_day.setdefault(d, []).append(e)
        self.ramadan = {d for e in events if e["kind"] == "ramadan" for d in event_days(e)}
        self.eid_fitr = sorted(e["day"] for e in events if e["kind"] == "eid_fitr")
        self.eid_adha = sorted(e["day"] for e in events if e["kind"] == "eid_adha")
        self.school = {d for e in events if e["kind"] == "school_holiday" for d in event_days(e)}
        self.bank = {e["day"] for e in events if e["kind"] == "bank_holiday"}
        self.paydays = sorted(e["day"] for e in events if e["kind"] == "payday")
        self.closures = []
        for c in cfg["closures"]:
            self.closures.append((dt.date.fromisoformat(c["start"]), dt.date.fromisoformat(c["end"])))
        self.unexplained = [(dt.date.fromisoformat(u["start"]), dt.date.fromisoformat(u["end"]), u["multiplier"]) for u in cfg["unexplained"]]
        # Daily random draws, made in a fixed order so the same seed always gives the same numbers.
        n = (end - start).days + 1
        self.noise = rng.normal(0.0, cfg["demand"]["noise_sigma"], n)
        shocks = rng.poisson(cfg["demand"]["shock_rate_per_year"] / 365.0, n) > 0
        self.shock = np.where(shocks, rng.normal(0.0, cfg["demand"]["shock_sigma"], n), 0.0)
        self.shock_days = [start + dt.timedelta(days=int(i)) for i in np.nonzero(shocks)[0]]

    # --- helpers -----------------------------------------------------------
    def is_closed(self, d: dt.date) -> str | None:
        if d.strftime("%m-%d") in self.cfg["effects"]["closed_days"]:
            return "closed_day"
        for a, b in self.closures:
            if a <= d <= b:
                return "closure"
        return None

    def open_hours(self, d: dt.date) -> list[int]:
        """Hours from the start of the trading day (may go past 24) the till is open."""
        o, c = self.cfg["hours"][d.isoweekday()]
        r = self.cfg["effects"].get("ramadan")
        if r and d in self.ramadan:
            c += r.get("late_close_extra_hours", 0)
        return list(range(o, c))

    def _payday_weekend(self, d: dt.date) -> bool:
        """From payday to the Sunday after it (Friday to Sunday when payday is a Friday)."""
        return any(p <= d <= p + dt.timedelta(days=7 - p.isoweekday()) for p in self.paydays)

    def _eid_mult(self, d: dt.date) -> tuple[float, str | None]:
        e = self.cfg["effects"]
        for start, mults, name in ((self.eid_fitr, e["eid_fitr"], "eid_fitr"), (self.eid_adha, e["eid_adha"], "eid_adha")):
            for s in start:
                k = (d - s).days
                if 0 <= k < len(mults):
                    return mults[k], f"{name}_day{k + 1}"
        return 1.0, None

    def price_index(self, d: dt.date) -> float:
        return self.menu.price_index(d)

    def weather_for(self, d: dt.date, hours: list[int]) -> dict:
        """Rain (mm) and mean temperature over the open hours, sunshine hours over the London day."""
        stamps = [self._hour_utc(d, h) for h in hours]
        sub = self.wh[self.wh["hour_start"].isin(stamps)]
        rain = float(sub["rain_mm"].sum()) if len(sub) else 0.0
        temp = float(sub["temp"].mean()) if len(sub) else 12.0
        sun = float(self.wd.loc[d, "sunshine_hours"]) if d in self.wd.index else 0.0
        return {"rain_mm": round(rain, 2), "temp": round(temp, 2), "sun_hours": sun, "sun_vs_normal": round(sun - self.sun_normal.get(d.month, 0.0), 2)}

    @staticmethod
    def _hour_utc(d: dt.date, h: int):
        day = d + dt.timedelta(days=h // 24)
        import pandas as pd
        return pd.Timestamp(dt.datetime(day.year, day.month, day.day, h % 24, tzinfo=LONDON).astimezone(UTC))

    # --- the model ---------------------------------------------------------
    def day(self, d: dt.date) -> dict:
        """Everything about trading day d: multipliers, weather, and lambda[hour][channel] without campaigns."""
        cfg, e = self.cfg, self.cfg["effects"]
        i = (d - self.start).days
        closed = self.is_closed(d)
        hours = self.open_hours(d)
        dm = cfg["demand"]
        m: dict[str, float] = {}
        years = (d - self.start).days / 365.25
        m["trend"] = (1 + dm["trend_per_year"]) ** years
        m["dow"] = dm["dow"][d.isoweekday() - 1]
        m["season"] = 1 + dm["season_amplitude"] * math.cos(2 * math.pi * (d.timetuple().tm_yday - dm["season_peak_doy"]) / 365.25)
        m["noise"] = math.exp(self.noise[i])
        m["shock"] = math.exp(self.shock[i])
        m["unexplained"] = next((u for a, b, u in self.unexplained if a <= d <= b), 1.0)
        m["bank_holiday"] = e["bank_holiday"] if d in self.bank else 1.0
        md = d.strftime("%m-%d")
        m["christmas_new_year"] = e["christmas_eve"] if md == "12-24" else e["new_years_eve"] if md == "12-31" else 1.0
        ram = e.get("ramadan")
        m["ramadan"] = ram["day_total"] if ram and d in self.ramadan else 1.0
        eid, eid_name = self._eid_mult(d)
        m["eid"] = eid
        m["chand_raat"] = e["chand_raat"] if any((s - d).days == 1 for s in self.eid_fitr) else 1.0
        m["school_holiday"] = e["school_holiday"] if d in self.school else 1.0
        m["payday"] = e["payday"] if self._payday_weekend(d) else 1.0
        pidx = self.price_index(d)
        m["price_index"] = pidx
        m["price_effect"] = pidx ** cfg["order_elasticity"]
        total = dm["base_orders"]
        for k in ("trend", "dow", "season", "noise", "shock", "unexplained", "bank_holiday", "christmas_new_year", "ramadan", "eid", "chand_raat", "school_holiday", "payday", "price_effect"):
            total *= m[k]

        w = self.weather_for(d, hours)
        we = e["weather"]
        share = dict(cfg["channels"])
        if ram and d in self.ramadan and ram.get("dine_in_share_shift"):
            s = ram["dine_in_share_shift"]
            share["dine_in"] += s
            share["takeaway"] = max(0.0, share["takeaway"] - s)
        wmult = {}
        for ch in CHANNELS:
            lg = we["rain"][ch] * min(w["rain_mm"], 10.0) + we["temp"][ch] * (w["temp"] - 15.0) + we["sun"][ch] * w["sun_vs_normal"]
            if w["temp"] > we["temp_hot_above"]:
                lg += we["temp_hot"][ch] * (w["temp"] - we["temp_hot_above"])
            wmult[ch] = math.exp(lg)

        prof = self.hour_profile(d, hours)
        lam = {h: {ch: total * share[ch] * wmult[ch] * prof[h] for ch in CHANNELS} for h in hours}

        # Football and venue events: extra orders in the hours around them.
        extras = []
        football = e["football"]
        for ev in self.by_day.get(d, []):
            if ev["type"] == "football" and ev["starts_at"] is not None and ev["starts_at"].astimezone(LONDON).date() == d:
                fx = ev["fixture"]
                lift = 1.0
                if ev["kind"] == "england":
                    lift = football["england"]
                elif {fx["home"], fx["away"]} & set(football["teams"]):
                    lift = football["team"]
                if lift != 1.0:
                    ko_h = self._local_hour_index(d, ev["starts_at"])
                    window = [h for h in (ko_h - 1, ko_h, ko_h + 1, ko_h + 2) if h in lam]
                    chans = ("takeaway", "delivery") if lift > 1 else ("dine_in",)
                    extras.append(self._spread(lam, window, chans, lift, f"football:{ev['name']}"))
            if ev.get("venue") and e["venue"]["max_lift"] > 0 and ev["starts_at"] is not None:
                dist = distance_m(self.lat, self.lon, ev["latitude"], ev["longitude"])
                lift = 1 + e["venue"]["max_lift"] * math.exp(-dist / e["venue"]["scale_m"]) * (ev["expected_size"] or 0) / 60000.0
                end_t = ev["ends_at"] if ev["kind"] != "premier_league" else ev["starts_at"] + dt.timedelta(hours=2)
                if ev["end_day"] and d != ev["end_day"]:
                    end_t = dt.datetime.combine(d, end_t.astimezone(LONDON).time(), tzinfo=LONDON)
                end_h = self._local_hour_index(d, end_t)
                window = [h for h in (end_h - 1, end_h, end_h + 1) if h in lam]
                extras.append(self._spread(lam, window, ("dine_in", "takeaway", "delivery"), lift, f"venue:{ev['name']}", distance=dist))
        if closed:
            lam = {}
        return {"day": d, "closed": closed, "hours": hours if not closed else [], "multipliers": m, "eid": eid_name,
                "weather": w, "weather_mult": wmult, "share": share, "total_before_events": 0.0 if closed else total,
                "lam": lam, "extras": [x for x in extras if x] if not closed else [], "ramadan": d in self.ramadan}

    def _local_hour_index(self, d: dt.date, t: dt.datetime) -> int:
        lt = t.astimezone(LONDON)
        return lt.hour + 24 * (lt.date() - d).days

    @staticmethod
    def _spread(lam, window, chans, lift, name, distance=None):
        if not window:
            return None
        day_ch = {ch: sum(lam[h][ch] for h in lam) for ch in chans}
        extra = {ch: (lift - 1.0) * day_ch[ch] for ch in chans}
        for ch in chans:
            if lift >= 1:
                for h in window:
                    lam[h][ch] += extra[ch] / len(window)
            else:
                for h in window:
                    lam[h][ch] *= lift
        return {"name": name, "lift": round(lift, 4), "hours": window, "channels": list(chans),
                "extra_orders": round(sum(extra.values()), 2), "distance_m": distance}

    def hour_profile(self, d: dt.date, hours: list[int]) -> dict[int, float]:
        cfg, e = self.cfg, self.cfg["effects"]
        prof_name = "weekend" if d.isoweekday() >= 6 else "normal"
        base = cfg["hourly"][prof_name]
        w = {h: float(base.get(h % 24, 1.0)) for h in hours}
        if e.get("jummah") and d.isoweekday() == 5:
            for h in e["jummah"]["friday_hours"]:
                if h in w:
                    w[h] *= 1 + e["jummah"]["lift"]
        if d in self.school and d.isoweekday() <= 5 and e["school_holiday_lunch"] != 1.0:
            for h in (12, 13, 14, 15):
                if h in w:
                    w[h] *= e["school_holiday_lunch"]
        ram = e.get("ramadan")
        if ram and d in self.ramadan:
            mg = self.prayer[d]["maghrib"].astimezone(LONDON)
            mg_h = mg.hour
            for h in w:
                if h < mg_h:
                    w[h] *= ram["daytime"]
                elif h in (mg_h, mg_h + 1):
                    w[h] *= ram["iftar_surge"]
                elif h >= 21:
                    w[h] *= ram["late_peak"]
            if hours and hours[-1] + 1 > cfg["hours"][d.isoweekday()][1]:
                w[hours[-1]] = max(w[hours[-1]], float(base.get((hours[-1] - 1) % 24, 1.0)) * ram["late_peak"] * 0.6)
        if any((s - d).days == 1 for s in self.eid_fitr) and e["chand_raat"] != 1.0:
            for h in w:
                if h >= 20:
                    w[h] *= 1.4
        tot = sum(w.values()) or 1.0
        return {h: v / tot for h, v in w.items()}


def all_days(dem: Demand) -> list[dict]:
    return [dem.day(d) for d in days(dem.start, dem.end)]
