"""The baseline's maths, the issue-time cut-off and the shared back-test, with no database."""

from __future__ import annotations

import datetime as dt

import pytest

from dinerai_analytics.backtest import rolling_backtest, truncate, window
from dinerai_analytics.cutoff import forecast_days, issue_time_for, known_through
from dinerai_analytics.models.forecast_baseline import build_series, predict, run
from dinerai_analytics.registry import PermanentError, RunContext

D = dt.date


# --- the cut-off ---------------------------------------------------------------
def test_issue_time_is_0535_london_in_summer_and_winter():
    assert issue_time_for(D(2026, 7, 1)) == dt.datetime(2026, 7, 1, 4, 35, tzinfo=dt.timezone.utc)
    assert issue_time_for(D(2026, 12, 1)) == dt.datetime(2026, 12, 1, 5, 35, tzinfo=dt.timezone.utc)
    # Clock-change days: still 05:35 on the UK clock.
    assert issue_time_for(D(2026, 3, 29)) == dt.datetime(2026, 3, 29, 4, 35, tzinfo=dt.timezone.utc)
    assert issue_time_for(D(2026, 10, 25)) == dt.datetime(2026, 10, 25, 5, 35, tzinfo=dt.timezone.utc)


def test_a_trading_day_is_known_once_it_has_ended():
    t = issue_time_for(D(2026, 10, 18))
    assert known_through(t, 5) == D(2026, 10, 17)  # the 17th ended at 05:00, before 05:35: yesterday counts
    assert known_through(t, 0) == D(2026, 10, 17)  # midnight
    assert known_through(t, 6) == D(2026, 10, 16)  # a 06:00 cut-off hasn't passed yet at 05:35
    # Clock-change nights.
    assert known_through(issue_time_for(D(2026, 3, 29)), 5) == D(2026, 3, 28)
    assert known_through(issue_time_for(D(2026, 10, 25)), 5) == D(2026, 10, 24)
    # Before the cut-off (a job started early by hand) the day before isn't known yet.
    assert known_through(dt.datetime(2026, 10, 18, 3, 0, tzinfo=dt.timezone.utc), 5) == D(2026, 10, 16)
    # Later in the day the day before is known.
    assert known_through(dt.datetime(2026, 10, 18, 12, 0, tzinfo=dt.timezone.utc), 5) == D(2026, 10, 17)


def test_forecast_days_are_the_issue_day_and_13_more():
    days = forecast_days(D(2026, 10, 18))
    assert len(days) == 14 and days[0] == D(2026, 10, 18) and days[-1] == D(2026, 10, 31)


# --- the rule --------------------------------------------------------------------
def weekly(start: D, values: list[float]) -> dict[D, float]:
    """One value per week on start's weekday."""
    return {start + dt.timedelta(days=7 * i): v for i, v in enumerate(values)}


def test_same_weekday_last_four_weeks():
    s = weekly(D(2026, 9, 1), [10, 20, 30, 40, 50])  # Tuesdays to 29 Sept
    # Target Tuesday 6 Oct, known through Sunday 4 Oct: the last 4 Tuesdays are 8, 15, 22, 29 Sept.
    assert predict(s, D(2026, 10, 6), D(2026, 10, 4)) == (20, 35, 50)
    # 13 days ahead (Tuesday 13 Oct): still the last 4 Tuesdays known, not ones in the future.
    assert predict(s, D(2026, 10, 13), D(2026, 10, 4)) == (20, 35, 50)
    # Known through Monday 21 Sept: the 22nd isn't known yet, so the 4 weeks are 15, 8, 1 Sept and 25 Aug (no data).
    assert predict(s, D(2026, 9, 29), D(2026, 9, 21)) == (10, 20, 30)


def test_closed_weeks_are_left_out_and_two_weeks_are_needed():
    s = weekly(D(2026, 9, 1), [10, 20, 30, 40])
    del s[D(2026, 9, 15)]  # closed that Tuesday
    assert predict(s, D(2026, 9, 29), D(2026, 9, 27)) == (10, pytest.approx(70 / 3), 40)
    sparse = {D(2026, 9, 22): 5.0}
    assert predict(sparse, D(2026, 9, 29), D(2026, 9, 27)) is None


def test_low_likely_high_are_ordered():
    s = weekly(D(2026, 9, 1), [7, 3, 9, 1])
    low, likely, high = predict(s, D(2026, 9, 29), D(2026, 9, 27))
    assert low <= likely <= high and (low, high) == (1, 9)


# --- the series ------------------------------------------------------------------
def test_series_from_daily_and_channels():
    daily = [
        {"day": D(2026, 3, 2), "net_pence": 100000, "transactions": 40, "covers": 30},
        {"day": D(2026, 3, 3), "net_pence": 0, "transactions": 0, "covers": None},  # closed
        {"day": D(2026, 3, 4), "net_pence": 90000, "transactions": 35, "covers": None},
    ]
    channels = [
        {"day": D(2026, 3, 2), "channel": "dine_in", "orders": 25, "covers": 30},
        {"day": D(2026, 3, 2), "channel": "delivery", "orders": 15, "covers": None},
        {"day": D(2026, 3, 3), "channel": "dine_in", "orders": 0, "covers": 0},  # the closed day is ignored
        {"day": D(2026, 3, 4), "channel": "dine_in", "orders": 35, "covers": 50},  # no delivery that day = 0
    ]
    s = build_series(daily, channels)
    assert s[("orders", "all")] == {D(2026, 3, 2): 40, D(2026, 3, 4): 35}
    assert s[("sales_pence", "all")] == {D(2026, 3, 2): 100000, D(2026, 3, 4): 90000}
    assert s[("covers", "all")] == {D(2026, 3, 2): 30}
    assert s[("orders", "delivery")] == {D(2026, 3, 2): 15, D(2026, 3, 4): 0}
    assert s[("covers", "dine_in")] == {D(2026, 3, 2): 30, D(2026, 3, 4): 50}
    assert ("covers", "delivery") not in s
    assert not any(k[0] == "sales_pence" and k[1] != "all" for k in s)  # channel sales include VAT: not forecast


# --- the back-test ---------------------------------------------------------------
def daily_series(start: D, days: int, value=lambda d: 10.0 + d.weekday()) -> dict[D, float]:
    return {start + dt.timedelta(days=i): value(start + dt.timedelta(days=i)) for i in range(days)}


def test_the_window_is_12_weeks_of_targets_known_at_issue():
    w = window(D(2026, 3, 2), 5)
    assert (w.targets_from, w.targets_to) == (D(2025, 12, 8), D(2026, 3, 1))
    assert w.origins[0] == D(2025, 11, 25) and w.origins[-1] == D(2026, 3, 1)


def test_the_backtest_never_shows_a_model_data_from_after_its_cutoff():
    actual = {("orders", "all"): daily_series(D(2025, 9, 1), 182)}
    seen = []

    def predict_origin(origin, issued, kt):
        known = truncate(actual[("orders", "all")], kt)
        assert max(known) <= kt < origin  # nothing from the issue day or later
        seen.append((origin, kt))
        return {("orders", "all"): {t: (9.0, 10.0, 11.0) for t in forecast_days(origin)}}

    rolling_backtest(actual, predict_origin, D(2026, 3, 2), 5)
    assert all(kt == o - dt.timedelta(days=1) for o, kt in seen)  # at 05:35 the day before has ended


def test_scores():
    actual = {("orders", "all"): {d: 10.0 for d in daily_series(D(2025, 9, 1), 182)}}
    perfect = rolling_backtest(actual, lambda o, i, kt: {("orders", "all"): {t: (10.0, 10.0, 10.0) for t in forecast_days(o)}}, D(2026, 3, 2), 5)
    s = perfect["series"][("orders", "all")]
    assert (s["wape"], s["coverage"], s["bias"], s["days"]) == (0.0, 1.0, 0.0, 84)
    assert s["n"] == 84 * 14 and s["by_horizon"]["0-6"]["n"] == 84 * 7
    high = rolling_backtest(actual, lambda o, i, kt: {("orders", "all"): {t: (11.0, 12.0, 13.0) for t in forecast_days(o)}}, D(2026, 3, 2), 5)
    s = high["series"][("orders", "all")]
    assert (s["wape"], s["coverage"], s["bias"]) == (0.2, 0.0, 0.2)


# --- the whole model, with a stand-in reader ---------------------------------------
class FakeReader:
    def __init__(self, daily, channels):
        self.daily, self.channels = daily, channels

    def rows(self, view, columns, where=(), null=(), order_by=(), restaurant_column="restaurant_id"):
        rows = self.daily if view == "sales_daily" else self.channels
        for col, op, value in where:
            assert col == "day"
            rows = [r for r in rows if (r["day"] >= value if op == ">=" else r["day"] <= value)]
        return rows


ISSUE = D(2026, 3, 2)
END = D(2026, 2, 28)


def make_ctx(daily, channels, issue_day=ISSUE):
    t = issue_time_for(issue_day)
    return RunContext(restaurant_id="r", reader=FakeReader(daily, channels), payload={}, issue_time=t, issue_day=issue_day,
                      known_through=known_through(t, 5), trading_day_cutoff_hour=5)


def history(days=150, end=END):
    daily, channels = [], []
    for i in range(days):
        d = end - dt.timedelta(days=i)
        orders = 40 + 5 * d.weekday() + (i % 3)
        daily.append({"day": d, "net_pence": orders * 2500, "transactions": orders, "covers": orders + 10})
        channels.append({"day": d, "channel": "dine_in", "orders": orders - 10, "covers": orders + 10})
        channels.append({"day": d, "channel": "delivery", "orders": 10, "covers": None})
    return sorted(daily, key=lambda r: r["day"]), channels


def test_a_full_run():
    daily, channels = history()
    result = run(make_ctx(daily, channels))
    rows = result.outputs["forecasts"]
    keys = {(r["metric"], r["channel"]) for r in rows}
    assert keys == {("orders", "all"), ("orders", "dine_in"), ("orders", "delivery"), ("covers", "all"), ("covers", "dine_in"), ("sales_pence", "all")}
    assert len(rows) == 14 * len(keys)
    assert all(r["low"] <= r["likely"] <= r["high"] for r in rows)
    assert result.passed and result.score == result.metrics["primary"]["wape"]
    assert result.metrics["primary"]["metric"] == "orders" and result.metrics["primary"]["channel"] == "all"
    assert [s["metric"] for s in result.metrics["series"]][:3] == ["orders", "orders", "orders"]
    assert result.metrics["backtest"]["weeks"] == 12
    assert 0 < result.metrics["primary"]["wape"] < 0.1


def test_too_little_history_runs_but_does_not_pass():
    daily, channels = history(days=30)
    result = run(make_ctx(daily, channels))
    assert not result.passed and result.outputs["forecasts"]


def test_no_sales_or_stale_sales_fail_without_retrying():
    with pytest.raises(PermanentError, match="No sales"):
        run(make_ctx([], []))
    daily, channels = history(end=D(2026, 1, 1))
    with pytest.raises(PermanentError, match="latest sales day"):
        run(make_ctx(daily, channels))
