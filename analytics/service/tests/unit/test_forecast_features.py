"""forecast_daily's feature builders, with no database: opening hours and clock changes, the trading-day
cut-off, the calendar and religious factors, uncertain dates, weather as issued, distance decay, sport
matches, deals and the price index as known at the issue time."""

from __future__ import annotations

import datetime as dt
import math

import numpy as np
import pytest

from dinerai_analytics.cutoff import LONDON, UTC, issue_time_for
from dinerai_analytics.models.forecast_daily.actions import PriceIndex, deal_factors, known_deals
from dinerai_analytics.models.forecast_daily.calendar_factors import Row, calendar_factors, easter, mothers_day, religious_factors, scenarios
from dinerai_analytics.models.forecast_daily.design import censor_weights
from dinerai_analytics.models.forecast_daily.events import Match, haversine_km, importance, sport_factors, venue_factors, venue_value
from dinerai_analytics.models.forecast_daily.hourly import HourProfiles, slot, split_exact
from dinerai_analytics.models.forecast_daily.hours import day_hours, hour_trading_day, open_intervals, parse_ranges, till_hours
from dinerai_analytics.models.forecast_daily.weather import Weather, normals

D = dt.date
LATE = {d: "16:00–02:00" for d in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")}


def at(day: D, hour: int, minute: int = 0) -> dt.datetime:
    return dt.datetime(day.year, day.month, day.day, hour, minute, tzinfo=LONDON).astimezone(UTC)


# --- opening hours, clock changes, the trading day ------------------------------------
def test_parse_ranges():
    assert parse_ranges("12:00 – 23:00") == [(720, 1380)]
    assert parse_ranges("16:00–02:00") == [(960, 1560)]  # past midnight: the next day
    assert parse_ranges("12:00-15:00, 17:00-22:30") == [(720, 900), (1020, 1350)]
    assert parse_ranges("Closed") == [] and parse_ranges(None) == []


def test_clock_changes_change_the_real_hours_open():
    r = {"opening_hours": LATE, "special_hours": {}}
    normal = day_hours(D(2026, 10, 17), r, [], 5)
    autumn = day_hours(D(2026, 10, 24), r, [], 5)  # the clocks go back during the night of the 24th
    spring = day_hours(D(2026, 3, 28), r, [], 5)  # the clocks go forward during the night of the 28th
    assert normal.hours_open == 10 and autumn.hours_open == 11 and spring.hours_open == 9


def test_till_hours_on_clock_change_nights():
    r = {"opening_hours": LATE, "special_hours": {}}
    autumn = {th.hour: th for th in day_hours(D(2026, 10, 24), r, [], 5).till}
    assert autumn[1].minutes == 120 and autumn[1].open_minutes == 120  # 01:00 happens twice, written once
    assert autumn[1].calendar_day == D(2026, 10, 25)
    spring = {th.hour: th for th in day_hours(D(2026, 3, 28), r, [], 5).till}
    assert 1 not in spring  # 01:00 to 02:00 never happens
    assert spring[0].open_minutes == 60


def test_trading_day_cutoff():
    # A 00:30 sale belongs to the evening before; 05:00 starts a new trading day.
    assert hour_trading_day(D(2026, 10, 18), 0, 5) == D(2026, 10, 17)
    assert hour_trading_day(D(2026, 10, 18), 4, 5) == D(2026, 10, 17)
    assert hour_trading_day(D(2026, 10, 18), 5, 5) == D(2026, 10, 18)
    hours = till_hours(D(2026, 10, 17), open_intervals(D(2026, 10, 17), LATE, {}), 5)
    labels = [th.hour for th in hours]
    assert labels[0] == 5 and labels[-1] == 4  # 05:00 on the 17th to 04:00 on the 18th
    assert {th.hour: th.calendar_day for th in hours}[1] == D(2026, 10, 18)
    assert sum(th.open_minutes for th in hours) == 600


def test_special_hours_and_closures():
    r = {"opening_hours": LATE, "special_hours": {"2026-12-24": {"label": "Christmas Eve", "hours": "12:00 – 18:00"}, "2026-12-31": {"hours": "usual"}}}
    assert day_hours(D(2026, 12, 24), r, [], 5).hours_open == 6
    assert day_hours(D(2026, 12, 31), r, [], 5).hours_open == 10
    closed = [(at(D(2026, 10, 17), 0), at(D(2026, 10, 18), 0))]
    assert day_hours(D(2026, 10, 17), r, closed, 5).hours_open == 2  # only 00:00 to 02:00 is left


# --- calendar --------------------------------------------------------------------------
def row(first, last=None, name="", type_="bank_holiday", **kw):
    return Row(id=f"{type_}-{first}", first_day=first, last_day=last or first, name=name, type=type_, scope=kw.pop("scope", "national"), **kw)


def test_mothers_day_and_easter():
    assert easter(2025) == D(2025, 4, 20) and easter(2026) == D(2026, 4, 5)
    assert mothers_day(2025) == D(2025, 3, 30) and mothers_day(2026) == D(2026, 3, 15)


def test_calendar_factors():
    days = [D(2026, 8, 28) + dt.timedelta(days=i) for i in range(8)]
    rows = [row(D(2026, 8, 31), region="england"), row(D(2026, 8, 28), type_="payday"),
            row(D(2026, 8, 29), D(2026, 9, 2), "Half term", "school_holiday", scope="council", council_code="E1"),
            row(D(2026, 8, 30), D(2026, 9, 4), "Elsewhere", "school_holiday", scope="council", council_code="E2")]
    f = calendar_factors(days, rows, "england", "E1")
    assert f["bank_holiday"] == {D(2026, 8, 31): 1.0}
    assert f["bh_eve"] == {D(2026, 8, 30): 1.0} and f["bh_after"] == {D(2026, 9, 1): 1.0}
    assert sorted(f["payday_window"]) == [D(2026, 8, 28), D(2026, 8, 29), D(2026, 8, 30)]
    assert sorted(f["school_holiday"]) == [D(2026, 8, 29) + dt.timedelta(days=i) for i in range(5)]  # only its own council's
    # A bank holiday of another nation doesn't count.
    assert "bank_holiday" not in calendar_factors(days, [row(D(2026, 8, 31), region="scotland")], "england", None)


def test_christmas_factors():
    days = [D(2026, 12, 23) + dt.timedelta(days=i) for i in range(11)]
    f = calendar_factors(days, [], "england", None)
    assert list(f["xmas_eve"]) == [D(2026, 12, 24)] and list(f["nye"]) == [D(2026, 12, 31)] and list(f["new_year"]) == [D(2027, 1, 1)]
    assert sorted(f["xmas_week"]) == [D(2026, 12, d) for d in (27, 28, 29, 30)]


def test_religious_factors_and_ramadan_phases():
    days = [D(2026, 2, 17) + dt.timedelta(days=i) for i in range(40)]
    rows = [row(D(2026, 2, 18), D(2026, 3, 19), "Ramadan", "religious"), row(D(2026, 3, 20), name="Eid al-Fitr", type_="religious")]
    f = religious_factors(days, rows)
    assert len(f["ramadan_1_10"]) == 10 and len(f["ramadan_11_20"]) == 10 and len(f["ramadan_last10"]) == 10
    assert list(f["chand_raat"]) == [D(2026, 3, 19)]
    assert list(f["eid_fitr_d1"]) == [D(2026, 3, 20)] and list(f["eid_fitr_d3"]) == [D(2026, 3, 22)]


def test_uncertain_dates_blend_the_two_days():
    eid = row(D(2026, 3, 20), name="Eid al-Fitr", type_="religious", date_uncertain=True, alt_day=D(2026, 3, 21))
    sc = scenarios(D(2026, 3, 20), [eid])
    assert sorted(p for p, _ in sc) == [0.5, 0.5]
    assert sorted(r[0].first_day for _, r in sc) == [D(2026, 3, 20), D(2026, 3, 21)]
    # A recorded probability is used.
    likely = Row(**{**eid.__dict__, "alt_probability": 0.8})
    assert sorted(p for p, _ in scenarios(D(2026, 3, 20), [likely])) == [pytest.approx(0.2), pytest.approx(0.8)]
    # Far from the date, or once confirmed, one scenario.
    assert len(scenarios(D(2026, 4, 10), [eid])) == 1
    assert len(scenarios(D(2026, 3, 20), [Row(**{**eid.__dict__, "date_uncertain": False})])) == 1
    # Without an alternative day: the day after.
    assert Row(**{**eid.__dict__, "alt_day": None}).shifted().first_day == D(2026, 3, 21)


# --- weather ----------------------------------------------------------------------------
def test_weather_as_issued_never_a_later_issue():
    target = D(2026, 10, 10)
    f = [{"issued_at": at(D(2026, 10, 5), 0), "target_day": target, "hour_start": None, "temp_max": 10, "temp_min": 5, "rain_mm": 1, "sunshine_hours": 2},
         {"issued_at": at(D(2026, 10, 8), 0), "target_day": target, "hour_start": None, "temp_max": 20, "temp_min": 9, "rain_mm": 0, "sunshine_hours": 8},
         {"issued_at": at(D(2026, 10, 9), 0), "target_day": target, "hour_start": None, "temp_max": 30, "temp_min": 9, "rain_mm": 9, "sunshine_hours": 1}]
    w = Weather([], [], f)
    assert w.issued_daily(target, issue_time_for(D(2026, 10, 8)))["temp_max"] == 20  # issued that midnight: known at 05:35
    assert w.issued_daily(target, at(D(2026, 10, 7), 23))["temp_max"] == 10  # before the 8th's issue
    assert w.issued_daily(target, at(D(2026, 10, 4), 23)) is None


def test_weather_day_7_on_is_the_seasonal_normal_from_known_days_only():
    archive = [{"day": D(2025, 1, 1) + dt.timedelta(days=i), "temp_max": 14.0, "temp_min": 6.0, "rain_mm": 2.0, "sunshine_hours": 4.0} for i in range(600)]
    n_all, n_early = normals(archive, D(2026, 12, 31)), normals(archive, D(2025, 2, 1))
    assert n_all.temp(D(2026, 7, 1)) == pytest.approx(10.0, abs=1.0)  # a flat 10 C history wins over the climatology
    assert abs(n_early.temp(D(2026, 7, 1)) - 10.0) > 2  # one month known: still near the climatology
    hours = day_hours(D(2026, 10, 20), {"opening_hours": LATE, "special_hours": {}}, [], 5)
    f = [{"issued_at": at(D(2026, 10, 12), 0), "target_day": D(2026, 10, 20), "hour_start": None, "temp_max": 30, "temp_min": 20, "rain_mm": 9,
          "sunshine_hours": 9}]
    vals, src = Weather(archive, [], f).forecast(D(2026, 10, 20), 7, hours, n_all, issue_time_for(D(2026, 10, 13)))
    assert src == "normal" and vals.get("temp_warm", 0) == 0 and "temp_hot" not in vals
    vals, src = Weather(archive, [], f).forecast(D(2026, 10, 20), 6, hours, n_all, issue_time_for(D(2026, 10, 14)))
    assert src == "issued_daily" and vals["temp_hot"] == 4 and vals["temp_warm"] > 0


def test_rain_windows_count_open_hours_only():
    day = D(2026, 10, 20)
    hourly = [{"hour_start": at(day, h), "rain_mm": 1.0} for h in range(24)]
    archive = [{"day": day, "temp_max": 15, "temp_min": 8, "rain_mm": 24.0, "sunshine_hours": 3}]
    w = Weather(archive, hourly, [])
    late = day_hours(day, {"opening_hours": LATE, "special_hours": {}}, [], 5)
    raw = w.raw_actual(day, late)
    assert raw[3] == 0.0 and raw[4] == 5.0  # closed at lunch; 17:00 to 22:00 open: 5 mm


# --- events -----------------------------------------------------------------------------
def test_distance_decay():
    assert venue_value(60_000, 0, True) == pytest.approx(6.0)
    assert venue_value(60_000, 2.0, True) == pytest.approx(6.0 * math.exp(-1))
    assert venue_value(60_000, 2.0, True, lam_km=4.0) == pytest.approx(6.0 * math.exp(-0.5))
    assert venue_value(60_000, 1.0, False) == 0.0 and venue_value(60_000, 1.0, None) > 0
    assert haversine_km(51.5, 0.0, 51.5, 0.0) == 0 and haversine_km(51.5, 0.0, 51.509, 0.0) == pytest.approx(1.0, abs=0.01)
    rows = [{"id": "e1", "first_day": D(2026, 10, 3), "last_day": D(2026, 10, 4), "type": "local_event", "expected_size": 20_000, "venue_id": None,
             "latitude": 51.5, "longitude": 0.0}]
    f = venue_factors(rows, {"e1": {"distance_m": 2000, "relevant": True}}, {}, {"latitude": 51.6, "longitude": 0.1})
    assert f["venue"] == {D(2026, 10, 3): pytest.approx(2 * math.exp(-1)), D(2026, 10, 4): pytest.approx(2 * math.exp(-1))}


def test_sport_matches_need_a_relevant_team_and_an_open_window():
    day = D(2026, 10, 17)
    hours = {day: day_hours(day, {"opening_hours": LATE, "special_hours": {}}, [], 5)}
    m = [Match("football", "World Cup group", "England", "Spain", at(day, 20)),
         Match("football", "Premier League", "Everton", "Fulham", at(day, 20)),
         Match("football", "Premier League", "West Ham", "Fulham", at(day, 11, 0)),  # over before opening
         Match("cricket", "ODI", "Pakistan", "India", at(day, 19))]
    f = sport_factors(m, {"West Ham"}, {"football": {"England"}, "cricket": {"Pakistan"}}, hours, 5)
    assert f["football_during"] == {day: 1.5} and f["football_after"] == {day: 1.5}  # England only; the West Ham match was before opening
    assert f["cricket_during"] == {day: 1.0}
    assert importance("Friendly") == 0.5 and importance("World Cup final") == 2.5 and importance("World Cup quarter-final") == 2.0


# --- own actions -------------------------------------------------------------------------
def test_deals_count_once_sent_by_the_issue_time():
    deals = [{"campaign_id": "c1", "valid_from": D(2026, 10, 20), "valid_until": D(2026, 10, 22), "send_at": at(D(2026, 10, 19), 10),
              "sent_at": None, "applies_to": None},
             {"campaign_id": "c2", "valid_from": D(2026, 10, 20), "valid_until": D(2026, 10, 20), "send_at": None, "sent_at": at(D(2026, 10, 10), 10),
              "applies_to": "delivery only"}]
    before = known_deals(deals, issue_time_for(D(2026, 10, 18)))
    assert [d["campaign_id"] for d in before] == ["c2"]
    assert [d["campaign_id"] for d in known_deals(deals, issue_time_for(D(2026, 10, 20)))] == ["c1", "c2"]
    assert "deal:c2" not in deal_factors(before, "dine_in") and deal_factors(before, "delivery")["deal:c2"] == {D(2026, 10, 20): 1.0}


def test_price_index_uses_prices_recorded_by_the_issue_time():
    prices = [{"dish_id": "a", "price_pence": 1000, "effective_from": D(2026, 1, 1), "recorded_at": at(D(2025, 12, 20), 9)},
              {"dish_id": "a", "price_pence": 1200, "effective_from": D(2026, 10, 20), "recorded_at": at(D(2026, 10, 15), 9)},
              {"dish_id": "b", "price_pence": 500, "effective_from": D(2026, 1, 1), "recorded_at": at(D(2025, 12, 20), 9)}]
    items = [{"day": D(2026, 10, 1), "quantity": 1, "dish_id": "a"}, {"day": D(2026, 10, 1), "quantity": 2, "dish_id": "b"}]
    pi = PriceIndex(prices, items)
    days = [D(2026, 10, 19), D(2026, 10, 21)]
    early = pi.series(days, issue_time_for(D(2026, 10, 14)), D(2026, 10, 13), D(2026, 1, 1))
    late = pi.series(days, issue_time_for(D(2026, 10, 16)), D(2026, 10, 15), D(2026, 1, 1))
    assert early == {D(2026, 10, 19): 0.0, D(2026, 10, 21): 0.0}  # the rise wasn't recorded yet
    assert late[D(2026, 10, 19)] == 0.0 and late[D(2026, 10, 21)] == pytest.approx(math.log(2200 / 2000))


def test_censoring_is_off_without_a_seat_capacity():
    y = np.array([10.0, 96.0, 50.0])
    assert censor_weights(y, None).tolist() == [1, 1, 1]
    assert censor_weights(y, 100).tolist() == [1, 0.3, 1]


# --- the hour profile: Ramadan maghrib and Jummah alignment -------------------------------
def _hours_by_day(days):
    r = {"opening_hours": {d: "12:00 – 23:00" for d in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")}, "special_hours": {}}
    return {d: day_hours(d, r, [], 5) for d in days}


def test_ramadan_profile_follows_maghrib_not_the_clock():
    days = [D(2026, 2, 18) + dt.timedelta(days=i) for i in range(20)]
    hbd = _hours_by_day(days)
    # Maghrib moves from 17:30 to 18:30; the busiest hour is always the one starting at maghrib.
    maghrib = {d: at(d, 17, 30) + dt.timedelta(minutes=3 * i) for i, d in enumerate(days)}
    prayer = {d: {"maghrib": maghrib[d], "dhuhr": at(d, 12, 15)} for d in days}
    counts = {"all": {}}
    for d in days[:-1]:
        peak = maghrib[d].astimezone(LONDON).hour + (1 if maghrib[d].astimezone(LONDON).minute >= 30 else 0)
        counts["all"][d] = {h: (30.0 if h == peak else 3.0) for h in range(12, 23)}
    static = {"ramadan_1_10": {d: 1.0 for d in days}}
    prof = HourProfiles(hbd, static, prayer, counts, set(days))
    target = days[-1]
    hrs, shares, kind = prof.shares(target, "all", days[-2])
    assert kind == "ramadan"
    tm = maghrib[target].astimezone(LONDON)
    expected_peak = tm.hour + (1 if tm.minute >= 30 else 0)
    assert hrs[int(np.argmax(shares))].hour == expected_peak
    assert slot(hrs[0], "maghrib", prayer[target]) is not None


def test_jummah_window_counted_from_dhuhr():
    day = D(2026, 10, 16)  # a Friday
    th = {t.hour: t for t in _hours_by_day([day])[day].till}
    p = {"dhuhr": at(day, 12, 50), "maghrib": at(day, 18, 0)}
    assert slot(th[13], "jummah", p) == 24  # 13:00 to 14:00: the first Jummah hour
    assert slot(th[15], "jummah", p) == 26
    assert slot(th[18], "jummah", p) == 18  # outside the window: its clock hour


def test_split_exact_adds_up():
    parts = split_exact(57.37, np.array([0.1, 0.25, 0.3, 0.35]))
    assert round(float(parts.sum()), 2) == 57.37 and all(parts >= 0)
