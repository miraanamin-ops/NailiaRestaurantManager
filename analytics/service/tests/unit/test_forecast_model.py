"""forecast_daily end to end on a small made-up restaurant (tests/unit/forecast_fixture.py), no database:
the fit, adding up (hours to days, channels to all), the same numbers for the same seed, no look-ahead in
the back-test, uncertain dates, the 07:00 refresh, the calibration, the pass bar, the defaults files,
and that the model never reads the generator's ground truth."""

from __future__ import annotations

import copy
import datetime as dt
import json
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import pytest

from dinerai_analytics.backtest import pooled, rolling_backtest
from dinerai_analytics.cutoff import issue_time_for, known_through
from dinerai_analytics.models.forecast_daily import defaults as dflt
from dinerai_analytics.models.forecast_daily import model
from dinerai_analytics.models.forecast_daily.design import FACTORS, Config, Prepared
from dinerai_analytics.models.forecast_daily.evaluate import cached_long, pass_bar
from dinerai_analytics.models.forecast_daily.model import make_profiles
from dinerai_analytics.models.forecast_daily.nb import fit_nb
from dinerai_analytics.models.forecast_daily.predict import predict
from dinerai_analytics.models.forecast_daily.ranges import Calibration, conformal_q
from dinerai_analytics.models.forecast_daily.refresh import refreshed_rows
from dinerai_analytics.registry import RunContext

from .forecast_fixture import RID, make_data

D = dt.date
END = D(2026, 9, 30)
PKG = Path(model.__file__).resolve().parent


def origin(day: D):
    it = issue_time_for(day)
    return it, known_through(it, 5)


def run_predict(data, issue_day: D, horizon: int = 14, cfg: Config | None = None):
    prep = Prepared(data, issue_day, 5, 56)
    it, kt = origin(issue_day)
    targets = [issue_day + dt.timedelta(days=h) for h in range(horizon)]
    return prep, predict(prep, cfg or Config(), it, kt, targets, RID, make_profiles(prep))


# --- the fit -------------------------------------------------------------------------
def test_the_fit_recovers_known_weights():
    rng = np.random.default_rng(3)
    n = 800
    X = np.column_stack([np.ones(n), rng.integers(0, 2, n), rng.normal(size=n)])
    beta = np.array([3.5, 0.3, -0.1])
    mu = np.exp(X @ beta)
    y = rng.poisson(rng.gamma(30, mu / 30))
    f = fit_nb(X, y.astype(float), np.zeros(n), np.ones(n), np.zeros(3), np.array([np.inf, 1, 1]))
    assert f.converged
    assert np.allclose(f.beta, beta, atol=3 * f.sd.max())
    assert 15 < f.theta < 60


def test_a_strong_prior_holds_a_weight_with_no_data():
    n = 300
    X = np.column_stack([np.ones(n), np.zeros(n)])
    y = np.full(n, 50.0)
    f = fit_nb(X, y, np.zeros(n), np.ones(n), np.array([0, 0.2]), np.array([np.inf, 0.05]))
    assert f.beta[1] == pytest.approx(0.2, abs=1e-3)


# --- adding up -----------------------------------------------------------------------
def test_hours_add_up_to_days_and_channels_to_all():
    prep, p = run_predict(make_data(end=END), END + dt.timedelta(days=1))
    days = p.targets
    for t in days:
        chans = sum(p.daily[("orders", c)][t][1] for c in prep.channels)
        assert round(chans, 2) == p.daily[("orders", "all")][t][1]
    checked = 0
    for (metric, ch), by_t in p.hourly.items():
        for t, hours in by_t.items():
            total = round(sum(trip[1] for _, trip in hours), 2)
            assert total == pytest.approx(p.daily[(metric, ch)][t][1], abs=0.005), (metric, ch, t)
            assert all(lo <= li <= hi for _, (lo, li, hi) in hours)
            checked += 1
    assert checked >= 14 * 3
    # The all-channel hours are the channels' hours (every channel here has at least 15%, so all are shown).
    t = days[2]
    for j, (_th, trip) in enumerate(p.hourly[("orders", "all")][t]):
        assert round(sum(p.hourly[("orders", c)][t][j][1][1] for c in prep.channels), 2) == pytest.approx(trip[1], abs=0.005)
    for by_t in p.daily.values():
        assert all(lo <= li <= hi for lo, li, hi in by_t.values())


def test_the_same_seed_gives_the_same_numbers():
    data = make_data(end=END)
    _, a = run_predict(data, END + dt.timedelta(days=1))
    _, b = run_predict(copy.deepcopy(data), END + dt.timedelta(days=1))
    assert a.daily == b.daily and a.hourly == b.hourly


# --- no look-ahead ---------------------------------------------------------------------
def test_the_back_test_never_uses_later_data():
    """Change everything that happened after an origin's cut-off: its forecast must not move."""
    data = make_data(end=END)
    o = END - dt.timedelta(days=30)
    it, kt = origin(o)
    poisoned = copy.deepcopy(data)
    for r in poisoned.daily:
        if r["day"] > kt:
            r["transactions"] = r["transactions"] * 3 + 7
            r["net_pence"] *= 3
    for rows in (poisoned.channels, poisoned.channel_hours, poisoned.hourly):
        for r in rows:
            if r["day"] > kt and r.get("orders") is not None:
                r["orders"] = r["orders"] * 3 + 1
            if r["day"] > kt and r.get("transactions") is not None:
                r["transactions"] = r["transactions"] * 3 + 1
    for r in poisoned.weather_daily:
        if r["day"] > kt:
            r["temp_max"], r["sunshine_hours"], r["rain_mm"] = 40.0, 15.0, 30.0
    for r in poisoned.weather_hourly:
        if r["hour_start"] > it:
            r["rain_mm"] = 9.0
    for r in poisoned.weather_forecasts:
        if r["issued_at"] > it:
            r["temp_max"], r["rain_mm"] = 45.0, 50.0
    for r in poisoned.items:
        if r["day"] > kt:
            r["quantity"] *= 50
    poisoned.prices.append({"dish_id": "dish-1", "price_pence": 5000, "effective_from": o + dt.timedelta(days=3), "recorded_at": it + dt.timedelta(hours=2)})
    poisoned.deals.append({"campaign_id": "late", "name": "Late", "valid_from": o + dt.timedelta(days=1), "valid_until": o + dt.timedelta(days=5),
                           "send_at": it + dt.timedelta(hours=3), "sent_at": it + dt.timedelta(hours=3), "applies_to": None})
    targets = [o + dt.timedelta(days=h) for h in range(14)]
    outs = []
    for d in (data, poisoned):
        prep = Prepared(d, END + dt.timedelta(days=1), 5, 56)
        outs.append(predict(prep, Config(), it, kt, targets, RID, make_profiles(prep)))
    assert outs[0].daily == outs[1].daily
    assert outs[0].hourly == outs[1].hourly


def test_the_back_test_window_only_scores_known_days():
    s = {D(2026, 9, 1) + dt.timedelta(days=i): 10.0 for i in range(60)}
    seen = []

    def predict_origin(o, issued, kt):
        seen.append((o, kt))
        return {"k": {o + dt.timedelta(days=h): (9, 10, 11) for h in range(14)}}

    res = rolling_backtest({"k": s}, predict_origin, D(2026, 10, 31), 5, weeks=4)
    assert res["series"]["k"]["n"] > 0
    assert all(kt == o - dt.timedelta(days=1) for o, kt in seen)  # each night knows up to the day before, never more
    assert pooled([res["series"]["k"], res["series"]["k"]])["wape"] == res["series"]["k"]["wape"]


# --- uncertain dates and the refresh -------------------------------------------------------
def test_an_uncertain_eid_blends_the_two_days_and_widens_the_range():
    eid = END + dt.timedelta(days=4)
    sure = make_data(end=END, eid=eid, eid_uncertain=False)
    unsure = make_data(end=END, eid=eid, eid_uncertain=True, eid_alt=eid + dt.timedelta(days=1))
    _, p_sure = run_predict(sure, END + dt.timedelta(days=1))
    _, p_unsure = run_predict(unsure, END + dt.timedelta(days=1))
    _, p_alt = run_predict(make_data(end=END, eid=eid + dt.timedelta(days=1), eid_uncertain=False), END + dt.timedelta(days=1))
    a_sure, a_unsure, a_alt = (p.daily[("orders", "all")] for p in (p_sure, p_unsure, p_alt))
    # Eid itself drops (half the draws say it's tomorrow) and the day after rises.
    assert a_unsure[eid][1] < a_sure[eid][1]
    assert a_unsure[eid + dt.timedelta(days=1)][1] > a_sure[eid + dt.timedelta(days=1)][1]
    # On both days the blend sits between the two candidates, and its range covers both of them.
    for day in (eid, eid + dt.timedelta(days=1)):
        lo, li, hi = a_unsure[day]
        a, b = sorted((a_sure[day][1], a_alt[day][1]))
        assert a <= li <= b and lo <= a and hi >= b


def _old_rows():
    rows = []
    for t in (D(2026, 10, 1), D(2026, 10, 2), D(2026, 10, 3)):
        for c, v in (("dine_in", 40.0), ("takeaway", 20.0), ("delivery", 6.0)):
            rows.append({"target_day": t, "hour_start": None, "local_hour": None, "metric": "orders", "channel": c,
                         "low": v * 0.8, "likely": v, "high": v * 1.2})
        rows.append({"target_day": t, "hour_start": None, "local_hour": None, "metric": "orders", "channel": "all", "low": 55.0, "likely": 66.0, "high": 77.0})
        rows.append({"target_day": t, "hour_start": None, "local_hour": None, "metric": "sales_pence", "channel": "all", "low": 100000.0, "likely": 120000.0,
                     "high": 140000.0})
        for j, h in enumerate((18, 19, 20)):
            hs = dt.datetime(t.year, t.month, t.day, h - 1, tzinfo=dt.timezone.utc)
            share = (0.2, 0.5, 0.3)[j]
            for c, v in (("dine_in", 40.0), ("takeaway", 20.0)):
                rows.append({"target_day": t, "hour_start": hs, "local_hour": h, "metric": "orders", "channel": c, "low": 0.0, "likely": round(v * share, 2),
                             "high": v})
            rows.append({"target_day": t, "hour_start": hs, "local_hour": h, "metric": "orders", "channel": "all", "low": 0.0, "likely": round(66 * share, 2),
                         "high": 66.0})
            rows.append({"target_day": t, "hour_start": hs, "local_hour": h, "metric": "sales_pence", "channel": "all", "low": 0.0,
                         "likely": round(120000 * share, 2), "high": 120000.0})
    return rows


def test_the_refresh_rescales_and_still_adds_up():
    targets = [D(2026, 10, 1), D(2026, 10, 2), D(2026, 10, 3)]
    ratio = {"dine_in": np.array([1.1, 1.0, 0.5]), "takeaway": np.array([1.0, 1.0, 1.0]), "delivery": np.array([2.0, 1.0, 1.0])}
    rows = refreshed_rows(_old_rows(), ratio, targets)
    daily = {(r["metric"], r["channel"], r["target_day"]): r for r in rows if r["hour_start"] is None}
    assert daily[("orders", "dine_in", targets[0])]["likely"] == 44.0
    assert daily[("orders", "delivery", targets[0])]["likely"] == 12.0
    assert daily[("orders", "all", targets[0])]["likely"] == 76.0  # the channels' sum
    assert daily[("orders", "all", targets[1])]["likely"] == 66.0  # nothing changed that day
    hourly = defaultdict(float)
    for r in rows:
        if r["hour_start"] is not None:
            hourly[(r["metric"], r["channel"], r["target_day"])] += r["likely"]
            assert r["low"] <= r["likely"] <= r["high"]
    for (m, c, t), v in hourly.items():
        assert round(v, 2) == pytest.approx(daily[(m, c, t)]["likely"], abs=0.005), (m, c, t)
    # Sales follow orders/all.
    assert daily[("sales_pence", "all", targets[0])]["likely"] == pytest.approx(120000 * 76 / 66, abs=0.01)


# --- ranges ------------------------------------------------------------------------------
def test_conformal_q_covers_80_percent():
    rng = np.random.default_rng(0)
    scores = list(np.abs(rng.normal(0, 1.5, 2000)))
    q = conformal_q(scores)
    assert np.mean(np.array(scores) <= q) == pytest.approx(0.80, abs=0.01)
    assert conformal_q([1.0] * 5) == 1.0  # too few: the simulation as it is


def test_calibration_never_uses_a_target_not_yet_known():
    cal = Calibration()
    for i in range(40):
        cal.add("orders", "all", 1, D(2026, 9, 1) + dt.timedelta(days=i), 100, 90, 95, 100)  # every actual far above: score 1
    for i in range(40):
        cal.add("orders", "all", 1, D(2026, 11, 1) + dt.timedelta(days=i), 200, 90, 95, 100)  # much later, much worse
    assert cal.q("orders", "all", 1, D(2026, 10, 15)) == pytest.approx(1.0)
    assert cal.q("orders", "all", 1, None) > 5


# --- the pass bar ------------------------------------------------------------------------
def test_the_pass_bar():
    prep = Prepared(make_data(end=END), END + dt.timedelta(days=1), 5, 56)

    def s(w, cov=0.8, bias=0.0, days=84):
        return {"wape": w, "coverage": cov, "bias": bias, "n": days * 14, "days": days}

    good = {"series": {("orders", "all"): s(0.13), **{("orders", c): s(0.21) for c in prep.channels}},
            "benchmarks": {"baseline": {("orders", "all"): s(0.13), **{("orders", c): s(0.20) for c in prep.channels}}}}
    long = {"wape": 0.134, "baseline_wape": 0.15}  # 10.7% better
    assert pass_bar(prep, good, 200, long)["passed"]  # level with the baseline on 12 weeks, channels 5% worse
    worse = copy.deepcopy(good)
    worse["series"][("orders", "all")] = s(0.131)  # worse than the baseline on the 12 weeks
    assert not pass_bar(prep, worse, 200, long)["passed"]
    assert not pass_bar(prep, good, 200, {"wape": 0.136, "baseline_wape": 0.15})["passed"]  # only 9.3% better over the long back-test
    assert not pass_bar(prep, good, 200, None)["passed"]  # no long back-test
    ch = copy.deepcopy(good)
    ch["series"][("orders", prep.channels[0])] = s(0.211)  # a deciding channel 5.5% worse
    assert not pass_bar(prep, ch, 200, long)["passed"]
    assert pass_bar(prep, {**good, "series": {**good["series"], ("orders", "all"): s(0.13, cov=0.88)}}, 200, long)["passed"]
    assert not pass_bar(prep, {**good, "series": {**good["series"], ("orders", "all"): s(0.13, cov=0.89)}}, 200, long)["passed"]
    assert not pass_bar(prep, {**good, "series": {**good["series"], ("orders", "all"): s(0.13, cov=0.74)}}, 200, long)["passed"]
    assert not pass_bar(prep, {**good, "series": {**good["series"], ("orders", "all"): s(0.13, bias=0.06)}}, 200, long)["passed"]
    assert not pass_bar(prep, good, 50, long)["passed"]  # under 8 weeks
    assert pass_bar(prep, good, 200, long)["deciding_channels"] == ["all", *prep.channels]


def test_the_long_back_test_is_reused_for_28_days():
    issue = dt.datetime(2026, 10, 17, 5, 35, tzinfo=dt.timezone.utc)
    run = {"model_version": "1.1.0", "data_cutoff": issue - dt.timedelta(days=10),
           "metrics": {"long_backtest": {"made_on": "2026-10-07", "wape": 0.1, "baseline_wape": 0.2}}}
    assert cached_long([run], issue, "1.1.0")["wape"] == 0.1
    assert cached_long([run], issue, "1.2.0") is None  # another version
    assert cached_long([{**run, "metrics": {"long_backtest": {"made_on": "2026-09-19"}}}], issue, "1.1.0") is None  # 28 days old


def test_under_8_weeks_no_forecast_and_not_passed(monkeypatch):
    data = make_data(end=END, days=40)
    monkeypatch.setattr(model.fdata, "load", lambda *a, **k: data)
    it, kt = origin(END + dt.timedelta(days=1))
    res = model.run(RunContext(RID, _NoRows(), {}, it, END + dt.timedelta(days=1), kt, 5))
    assert res.outputs == {} and res.passed is False and "skipped" in res.metrics


class _NoRows:
    def rows(self, *a, **k):
        return []


def test_a_full_nightly_run(monkeypatch):
    data = make_data(end=END, days=150)
    monkeypatch.setattr(model.fdata, "load", lambda *a, **k: data)
    issue = END + dt.timedelta(days=1)
    it, kt = origin(issue)
    res = model.run(RunContext(RID, _NoRows(), {}, it, issue, kt, 5))
    rows = res.outputs["forecasts"]
    daily = [r for r in rows if r["hour_start"] is None]
    assert {r["target_day"] for r in daily} == {issue + dt.timedelta(days=h) for h in range(56)}
    assert {r["target_day"] for r in rows if r["hour_start"] is not None} == {issue + dt.timedelta(days=h) for h in range(14)}
    assert {(r["metric"], r["channel"]) for r in daily} >= {("orders", "all"), ("orders", "dine_in"), ("sales_pence", "all"), ("covers", "all")}
    assert all(r["low"] <= r["likely"] <= r["high"] for r in rows)
    coefs = res.outputs["model_coefficients"]
    assert {r["channel"] for r in coefs} == {"dine_in", "takeaway", "delivery"}
    assert all(r["factor"] and r["estimate"] == r["estimate"] for r in coefs)
    assert res.outputs["forecast_drivers"] and all(r["multiplier"] > 0 for r in res.outputs["forecast_drivers"])
    m = res.metrics
    assert m["pass"]["passed"] == res.passed and m["primary"]["metric"] == "orders"
    assert m["long_backtest"]["cutoffs"] > 10 and not m["long_backtest"]["cached"]
    assert any(c["check"] == "orders/all long back-test WAPE vs baseline" for c in m["pass"]["checks"])
    assert {b["metric"] for b in m["benchmarks"]["baseline"]} >= {"orders"} and set(m["benchmarks"]) == {"last_week", "baseline", "ets"}
    json.dumps(m, default=str)


# --- the defaults and the ground truth ------------------------------------------------------
def test_every_defaults_file_is_valid_and_every_weight_has_a_reason():
    for kind in dflt.TYPES:
        raw = json.loads((dflt.HERE / f"{kind}.json").read_text(encoding="utf8"))
        for name, e in raw.get("factors", {}).items():
            assert e.get("reason", "").strip(), f"{kind}.json: {name} has no reason"
            assert e["sd"] > 0
        for block in ("weekday_pct", "season"):
            if block in raw:
                assert raw[block]["reason"].strip()
        d = dflt.load(kind)
        missing = [f for f in FACTORS if f not in d["factors"]]
        assert not missing, f"{kind}: no default for {missing}"
        for f in ("deal", "log_price_index", "trend", "weekday_summer"):
            assert f in d["factors"]
    assert dflt.load("halal")["factors"]["diwali"]["effect_pct"] == {"all": 0}
    assert dflt.load("cafe")["factors"]["diwali"]["effect_pct"] == {"all": 0}
    general = dflt.load("general")["factors"]["diwali"]
    assert (general["effect_pct"], general["sd"]) == ({"dine_in": 5}, 0.15) and general["reason"]


def test_restaurant_type_from_the_cuisine():
    assert dflt.restaurant_type("Halal South Asian") == "halal"
    assert dflt.restaurant_type("Cafe and brunch") == "cafe" and dflt.restaurant_type("Neighbourhood café and bakery") == "cafe"
    assert dflt.restaurant_type("Takeaway: peri-peri, burgers, pizza") == "takeaway"
    assert dflt.restaurant_type("Italian") == "general" and dflt.restaurant_type(None) == "general"


def test_the_model_never_reads_the_ground_truth():
    """No file in the model's package mentions the generator's answers, and only defaults.py opens files (its own JSON)."""
    for f in PKG.rglob("*.py"):
        text = f.read_text(encoding="utf8")
        assert not re.search(r"ground_truth|groundtruth|answers\.json|analytics[/\\]generator|output[/\\]", text, re.I), f.name
        if f.name != "defaults.py":
            assert not re.search(r"\bopen\(|read_text|read_bytes|np\.load|json\.load\(", text), f"{f.name} reads a file"
    assert "HERE / " in (PKG / "defaults.py").read_text(encoding="utf8")


def test_a_cricket_fixture_counts_as_cricket_and_football_stays_football():
    # analytics.football_fixtures.sport (041): the builder enters cricket; a row without it is football.
    data = make_data()
    day = D(2026, 9, 26)  # a Saturday in the fixture's history
    kick = dt.datetime(2026, 9, 26, 13, 0, tzinfo=dt.timezone.utc)  # 14:00 UK, open hours
    data.fixtures = [
        {"event_id": "c1", "sport": "cricket", "competition": "T20 World Cup group stage", "home_team": "Pakistan", "away_team": "India", "kickoff_at": kick},
        {"event_id": "f1", "competition": "Friendly", "home_team": "England", "away_team": "Wales", "kickoff_at": kick},
    ]
    prep = Prepared(data, END, 5, 56)
    assert prep.static["cricket_during"][day] == pytest.approx(1.5)  # a tournament group, Pakistan followed by halal restaurants
    assert prep.static["football_during"][day] == pytest.approx(0.5)  # a friendly
