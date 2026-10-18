"""The design: per restaurant and channel, the columns of

  log mu(d) = level + trend t + season(day of year) + weekday [+ weekday x summer]
              + sum_k beta_k x_k(d) + log(hours open on d / usual hours)

their priors (defaults.py), and the rows for training (known days, actual weather)
and for forecast days (weather as issued, deals and prices as known at the issue
time, uncertain religious dates as scenarios).

Prepared holds what doesn't depend on the issue time (built once per run); an
origin (issue time plus last known trading day) gives one fit's matrices. Every
origin only ever uses data known by its issue time: sales and weather up to its
last known day, deals sent and prices recorded by then, forecasts issued by then.
"""

from __future__ import annotations

import datetime as dt
import math
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from ...cutoff import london_day
from . import defaults as dflt
from .actions import PriceIndex, deal_factors, known_deals
from .calendar_factors import CALENDAR_FACTORS, RELIGIOUS_FACTORS, Row, calendar_factors, religious_factors, scenarios
from .data import Data
from .events import EVENT_FACTORS, Match, sport_factors, venue_factors
from .hours import DayHours, closure_cuts, day_hours, has_opening_hours
from .weather import WEATHER_FACTORS, Normals, Weather

CHANNELS = ("dine_in", "takeaway", "delivery")
WEEKDAY_COLS = tuple(f"weekday_{d}" for d in dflt.WEEKDAYS)
FACTORS = (*CALENDAR_FACTORS, *RELIGIOUS_FACTORS, *WEATHER_FACTORS, *EVENT_FACTORS)
MIN_HISTORY_DAYS = 56  # 8 weeks
SEASON_HISTORY_DAYS = 365  # under 12 months the season is fixed at its default
FIXED_SD = 1e-3  # a weight fixed at its default
CENSOR_SHARE = 0.95  # dine-in at 95% of seat capacity or more = censored
CENSOR_WEIGHT = 0.3


@dataclass(frozen=True)
class Config:
    k_season: int = 3
    wd_summer: bool = False
    level: str = "decay"  # decay: time-decay weights; correction: long half-life + last 4 weeks' residual correction
    all_method: str = "sum"  # sum of the channel models, or a direct all-channel model
    half_life_weeks: float = 26.0
    long_half_life_weeks: float = 104.0
    correction_days: int = 28
    venue_lambda_km: float = 2.0

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}

    @staticmethod
    def from_dict(d: dict) -> Config:
        return Config(**{k: v for k, v in d.items() if k in Config.__dataclass_fields__})


def is_summer(d: dt.date) -> bool:
    return 4 <= d.month <= 9


def censor_weights(dine_in: np.ndarray, capacity: float | None) -> np.ndarray:
    """Down-weight days where dine-in reached 95% of capacity (demand above what was served). Seat capacity isn't
    recorded yet, so with no capacity every weight is 1."""
    w = np.ones(len(dine_in))
    if capacity:
        w[dine_in >= CENSOR_SHARE * capacity] = CENSOR_WEIGHT
    return w


@dataclass
class Design:
    channel: str
    columns: list[str]
    prior_mean: np.ndarray
    prior_sd: np.ndarray
    train_days: list[dt.date]
    X: np.ndarray
    y: np.ndarray
    offset: np.ndarray
    w: np.ndarray
    active: np.ndarray  # columns with any non-zero value in training (the rest stay at their prior)
    targets: list[dt.date] = field(default_factory=list)
    # Per target: [(probability, x row)], more than one when an uncertain religious date is near.
    target_rows: list[list[tuple[float, np.ndarray]]] = field(default_factory=list)
    target_offset: np.ndarray = field(default_factory=lambda: np.zeros(0))
    target_open: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))
    weather_source: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class Prepared:
    """Everything that doesn't depend on the issue time."""

    def __init__(self, data: Data, issue_day: dt.date, cutoff_hour: int, horizon_days: int = 56):
        self.data = data
        self.restaurant = data.restaurant
        self.cutoff_hour = cutoff_hour
        self.kind = dflt.restaurant_type(self.restaurant.get("cuisine"))
        self.defaults = dflt.load(self.kind)
        self.notes: list[str] = []

        sales_days = [r["day"] for r in data.daily]
        self.first_day = min(sales_days) if sales_days else issue_day
        self.last_day = issue_day + dt.timedelta(days=horizon_days - 1)
        self.days = [self.first_day + dt.timedelta(days=i) for i in range((self.last_day - self.first_day).days + 1)]

        # Hours open, after closures. With no opening hours set yet, every day counts as open all day.
        cuts = closure_cuts(data.events)
        all_day = not has_opening_hours(self.restaurant)
        if all_day:
            self.notes.append("no opening hours are set: every day counts as open all day (no hours-open offset)")
        self.hours: dict[dt.date, DayHours] = {d: day_hours(d, self.restaurant, cuts, cutoff_hour, all_day) for d in self.days}
        open_hours = [h.hours_open for h in self.hours.values() if h.hours_open > 0]
        self.usual_hours = float(np.median(open_hours)) if open_hours else 1.0
        self.unusual = {d for e in data.events if e.get("treat_as_unusual") for d in _span(e["first_day"], e["last_day"])}

        # Calendar, religious and event factors on the recorded dates.
        self.cal_rows = [Row.from_view(r) for r in data.calendar]
        nation, council = self.restaurant.get("nation"), self.restaurant.get("council_code")
        self.static: dict[str, dict[dt.date, float]] = defaultdict(dict)
        self.static.update(calendar_factors(self.days, self.cal_rows, nation, council))
        self.static.update(religious_factors(self.days, self.cal_rows))
        teams = set(data.teams)
        national = {s: set(dflt.national_teams(self.defaults, s)) for s in ("football", "cricket")}
        matches = [Match("football", f["competition"] or "", f["home_team"] or "", f["away_team"] or "", f["kickoff_at"])
                   for f in data.fixtures if f.get("kickoff_at")]
        self.static.update(sport_factors(matches, teams, national, self.hours, cutoff_hour))
        rel = {str(r["event_id"]): r for r in data.relevance}
        venues = {str(v["id"]): v for v in data.venues}
        self.static.update(venue_factors(data.calendar, rel, venues, self.restaurant, Config().venue_lambda_km))

        # Weather: raw daily values for the history (normals are applied per origin).
        self.weather = Weather(data.weather_daily, data.weather_hourly, data.weather_forecasts)
        self._raw = {d: raw for d in self.days if (raw := self.weather.raw_actual(d, self.hours[d])) is not None}
        self._normals: dict[dt.date, Normals] = {}

        # Orders: the all total and each channel.
        self.y: dict[str, dict[dt.date, float]] = {"all": {}}
        self.zero_days = set()
        for r in data.daily:
            if r["transactions"] is None:
                continue
            if not r["transactions"]:
                self.zero_days.add(r["day"])  # the whole restaurant had no orders: closed or missing, never a zero
                continue
            self.y["all"][r["day"]] = float(r["transactions"])
        by_day: dict[dt.date, dict[str, float]] = defaultdict(dict)
        for r in data.channels:
            if r["channel"] in CHANNELS and r["orders"] is not None:
                by_day[r["day"]][r["channel"]] = float(r["orders"])
        seen = [c for c in CHANNELS if any(c in v for v in by_day.values())]
        for c in seen:
            self.y[c] = {d: v.get(c, 0.0) for d, v in by_day.items() if d in self.y["all"]}  # a channel missing on a trading day had 0
        self.channels = seen
        totals = {c: sum(self.y[c].values()) for c in seen}
        grand = sum(totals.values()) or 1.0
        self.shares = {c: totals[c] / grand for c in seen}

        self.prices = PriceIndex(data.prices, data.items)
        self.deals = data.deals

    # --- per origin ---
    def normals(self, kt: dt.date) -> Normals:
        if kt not in self._normals:
            self._normals[kt] = self.weather.normals(kt)
        return self._normals[kt]

    def valid_days(self, channel: str, kt: dt.date) -> list[dt.date]:
        ys = self.y.get(channel, {})
        return [d for d in sorted(ys) if d <= kt and d not in self.unusual and self.hours.get(d) and self.hours[d].hours_open > 0
                and d in self.y["all"]]

    def shares_at(self, kt: dt.date) -> dict[str, float]:
        """Each channel's share of orders on the days known by kt."""
        totals = {c: sum(v for d, v in self.y[c].items() if d <= kt) for c in self.channels}
        grand = sum(totals.values()) or 1.0
        return {c: totals[c] / grand for c in self.channels}

    def history_span(self, kt: dt.date) -> int:
        days = [d for d in self.y["all"] if d <= kt]
        return (kt - min(days)).days + 1 if days else 0

    def columns(self, cfg: Config, deals: list[dict]) -> list[str]:
        cols = ["level", "trend"]
        cols += [f"season_{t}{k}" for k in range(1, cfg.k_season + 1) for t in ("cos", "sin")]
        cols += list(WEEKDAY_COLS)
        if cfg.wd_summer:
            cols += [f"wd_summer_{d}" for d in dflt.WEEKDAYS]
        cols += list(FACTORS)
        cols += sorted({f"deal:{d['campaign_id']}" for d in deals})
        cols.append("log_price_index")
        return cols

    def priors(self, cfg: Config, cols: list[str], channel: str, train_days: list[dt.date], span: int,
               shares: dict[str, float] | None = None) -> tuple[np.ndarray, np.ndarray]:
        d = self.defaults
        shares = shares if shares is not None else self.shares
        mean, sd = np.zeros(len(cols)), np.ones(len(cols))
        wd_mean, wd_sd = dflt.weekday_priors(d)
        # The offset already carries longer or shorter opening hours: take that out of the weekday guess.
        off = defaultdict(list)
        for day in train_days:
            off[day.weekday()].append(math.log(self.hours[day].hours_open / self.usual_hours))
        season_mean, season_sd = dflt.season_priors(d, cfg.k_season)
        for i, c in enumerate(cols):
            if c == "level":
                mean[i], sd[i] = 0.0, math.inf
            elif c.startswith("season_"):
                k = int(c[-1])
                j = 2 * (k - 1) + (0 if c.startswith("season_cos") else 1)
                mean[i], sd[i] = season_mean[j], season_sd if span >= SEASON_HISTORY_DAYS else FIXED_SD
            elif c.startswith("weekday_"):
                w = dflt.WEEKDAYS.index(c.split("_")[1])
                mean[i], sd[i] = wd_mean[w] - (float(np.mean(off[w])) if off[w] else 0.0), wd_sd
            else:
                p = dflt.all_channel_prior(d, c, shares) if channel == "all" else dflt.factor_prior(d, c, channel)
                mean[i], sd[i] = p.mean, p.sd
        return mean, sd

    def _weather_train(self, days: list[dt.date], normal: Normals) -> dict[str, np.ndarray]:
        n = len(days)
        out = {f: np.zeros(n) for f in WEATHER_FACTORS}
        for i, d in enumerate(days):
            raw = self._raw.get(d)
            if raw is None:
                continue
            tmean, tmax, sun, rl, rd = raw
            if tmean is not None:
                dev = tmean - normal.temp(d)
                out["temp_warm"][i], out["temp_cold"][i] = max(dev, 0.0), max(-dev, 0.0)
            if tmax is not None:
                out["temp_hot"][i] = max(float(tmax) - 26.0, 0.0)
            sn = normal.sunshine(d)
            if sun is not None and sn is not None:
                out["sunshine"][i] = float(sun) - sn
            out["rain_lunch"][i], out["rain_dinner"][i] = rl, rd
        return out

    def _base_rows(self, days: list[dt.date], cols: list[str], cfg: Config, kt: dt.date, static: dict[str, dict[dt.date, float]],
                   deal_days: dict[str, dict[dt.date, float]], price: dict[dt.date, float]) -> np.ndarray:
        idx = {c: i for i, c in enumerate(cols)}
        X = np.zeros((len(days), len(cols)))
        X[:, idx["level"]] = 1.0
        t = np.array([(d - kt).days / 365.25 for d in days])
        X[:, idx["trend"]] = t
        doy = np.array([d.timetuple().tm_yday for d in days], dtype=float)
        for k in range(1, cfg.k_season + 1):
            X[:, idx[f"season_cos{k}"]] = np.cos(2 * math.pi * k * doy / 365.25)
            X[:, idx[f"season_sin{k}"]] = np.sin(2 * math.pi * k * doy / 365.25)
        for i, d in enumerate(days):
            name = dflt.WEEKDAYS[d.weekday()]
            X[i, idx[f"weekday_{name}"]] = 1.0
            if cfg.wd_summer and is_summer(d):
                X[i, idx[f"wd_summer_{name}"]] = 1.0
        row_of = {d: i for i, d in enumerate(days)}
        for f, by_day in (*static.items(), *deal_days.items()):
            j = idx.get(f)
            if j is None:
                continue
            for d, v in by_day.items():
                i = row_of.get(d)
                if i is not None:
                    X[i, j] = v
        j = idx["log_price_index"]
        for i, d in enumerate(days):
            X[i, j] = price.get(d, 0.0)
        return X

    def design(self, cfg: Config, channel: str, issue_time: dt.datetime, kt: dt.date, targets: list[dt.date]) -> Design:
        train_days = self.valid_days(channel, kt)
        deals = known_deals(self.deals, issue_time)
        deal_days = deal_factors(deals, channel)
        cols = self.columns(cfg, deals)
        price = self.prices.series(train_days + targets, issue_time, kt, self.first_day)
        normal = self.normals(kt)
        span = self.history_span(kt)
        notes = []

        X = self._base_rows(train_days, cols, cfg, kt, self.static, deal_days, price)
        idx = {c: i for i, c in enumerate(cols)}
        for f, v in self._weather_train(train_days, normal).items():
            X[:, idx[f]] = v
        y = np.array([self.y[channel][d] for d in train_days])
        offset = np.array([math.log(self.hours[d].hours_open / self.usual_hours) for d in train_days])
        half = cfg.half_life_weeks if cfg.level == "decay" else cfg.long_half_life_weeks
        age = np.array([(kt - d).days for d in train_days], dtype=float)
        w = 0.5 ** (age / (half * 7))
        if channel == "dine_in":
            w = w * censor_weights(y, None)
        active = np.any(X != 0, axis=0)
        active[idx["level"]] = True
        mean, sd = self.priors(cfg, cols, channel, train_days, span, self.shares_at(kt) if channel == "all" else None)
        if span < SEASON_HISTORY_DAYS:
            notes.append("under 12 months of history: the season is fixed at its default")

        # Forecast days: weather as issued, the calendar's scenarios for uncertain dates.
        T = self._base_rows(targets, cols, cfg, kt, self.static, deal_days, price)
        sources = []
        issue_day = london_day(issue_time)
        for i, d in enumerate(targets):
            vals, src = self.weather.forecast(d, (d - issue_day).days, self.hours[d], normal, issue_time)
            sources.append(src)
            for f in WEATHER_FACTORS:
                T[i, idx[f]] = vals.get(f, 0.0)
        rows: list[list[tuple[float, np.ndarray]]] = []
        nation, council = self.restaurant.get("nation"), self.restaurant.get("council_code")
        dated = set(CALENDAR_FACTORS) | set(RELIGIOUS_FACTORS)
        for i, d in enumerate(targets):
            sc = scenarios(d, self.cal_rows)
            if len(sc) == 1:
                rows.append([(1.0, T[i])])
                continue
            options = []
            for p, cal in sc:
                x = T[i].copy()
                f_all = {**calendar_factors([d], cal, nation, council), **religious_factors([d], cal)}
                for f in dated:
                    x[idx[f]] = f_all.get(f, {}).get(d, 0.0)
                options.append((p, x))
            rows.append(options)
        t_off = np.array([math.log(self.hours[d].hours_open / self.usual_hours) if self.hours[d].hours_open > 0 else 0.0 for d in targets])
        t_open = np.array([self.hours[d].hours_open > 0 for d in targets], dtype=bool)
        return Design(channel, cols, mean, sd, train_days, X, y, offset, w, active, targets, rows, t_off, t_open, sources, notes)


def _span(a: dt.date, b: dt.date):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)
