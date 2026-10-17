"""The generator: same seed, same data; the totals reconcile; every row is marked."""

from __future__ import annotations

import collections
import datetime as dt
import hashlib

from conftest import END, SEED
from generate import generate
from synth.datasets import DATASETS

DEMO_IDS = {d["id"] for d in DATASETS.values()}
NO_SOURCE = {"recipe_lines", "invoice_lines"}  # no source column in the schema
OLD_TABLES = NO_SOURCE | {"sales_days", "sales_hours", "sales_items", "weather_days", "drafts", "campaigns", "restaurants", "venues", "football_fixtures"}


def _hashes(folder):
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(folder.rglob("*")) if f.is_file()}


def test_same_seed_same_files(built, tmp_path):
    generate("halal_ilford", SEED, END, inputs=False, out_root=tmp_path, fixtures_root=None)
    assert _hashes(tmp_path / "halal_ilford") == _hashes(built["halal_ilford"]["dir"])


def test_a_different_seed_gives_different_sales(built, tmp_path):
    generate("halal_ilford", SEED + 1, END, inputs=False, out_root=tmp_path, fixtures_root=None)
    a = (built["halal_ilford"]["dir"] / "load" / "27_sales_days.jsonl").read_bytes()
    b = (tmp_path / "halal_ilford" / "load" / "27_sales_days.jsonl").read_bytes()
    assert a != b


def test_24_months_ending_on_the_end_date(built):
    gt = built["halal_ilford"]["gt"]
    assert gt["window"] == {"start": "2024-10-17", "end": "2026-10-16"}
    days = [r["day"] for r in built["halal_ilford"]["rows"]["sales_days"]]
    assert min(days) == "2024-10-17" and max(days) == "2026-10-16"


def test_every_row_is_marked_and_belongs_to_the_demo_restaurant(built):
    for key in ("halal_ilford", "halal_ilford_messy"):
        rid = DATASETS[key]["id"]
        for t, rows in built[key]["rows"].items():
            for r in rows:
                if "restaurant_id" in r:
                    assert r["restaurant_id"] == rid, t
                if t in ("sales_days", "sales_hours"):
                    assert r["is_dummy"] and r["source"] == "seed" and r["covers_source"] == "synthetic"
                elif t == "sales_items":
                    assert r["is_dummy"]
                elif t == "weather_days":
                    assert r["source"] == "archive"
                elif t not in OLD_TABLES:
                    assert r.get("source") == "synthetic", t
        assert built[key]["rows"]["restaurants"] == [dict(built[key]["rows"]["restaurants"][0], is_demo=True, active=False)]


def test_item_hour_and_channel_sales_add_up_to_the_day(built):
    rows = built["halal_ilford"]["rows"]
    pence = lambda x: round(x * 100)
    days = {r["day"]: r for r in rows["sales_days"]}
    items = collections.Counter()
    for r in rows["sales_items"]:
        items[r["day"]] += pence(r["amount"])
    hours, hour_orders, hour_covers = collections.Counter(), collections.Counter(), collections.Counter()
    for r in rows["sales_hours"]:
        hours[r["day"]] += pence(r["sales"])
        hour_orders[r["day"]] += r["transactions"]
        hour_covers[r["day"]] += r["covers"]
    ch_day, ch_hour = collections.Counter(), collections.Counter()
    for r in rows["sales_channel_splits"]:
        if r["hour"] is None:
            ch_day[r["day"]] += r["sales_pence"]
        else:
            ch_hour[(r["day"], r["hour"])] += r["sales_pence"]
    for d, r in days.items():
        g = pence(r["gross_sales"])
        assert items[d] == g, d
        assert hours[d] == g, d
        assert ch_day[d] == g, d
        assert hour_orders[d] == r["transactions"] and hour_covers[d] == r["covers"], d
        assert pence(r["card"]) + pence(r["cash"]) == g, d
        assert pence(r["net_sales"]) + pence(r["vat"]) == g, d
    for r in rows["sales_hours"]:
        assert ch_hour[(r["day"], r["hour"])] == pence(r["sales"])


def test_hours_times_rates_match_labour_cost(built):
    rows, gt = built["halal_ilford"]["rows"], built["halal_ilford"]["gt"]
    rates = collections.defaultdict(list)
    for p in rows["staff_pay_rates"]:
        rates[p["staff_id"]].append((p["effective_from"], p["hourly_pence"]))
    week = collections.Counter()
    for a in rows["shift_actuals"]:
        s = dt.datetime.fromisoformat(a["starts_at"].replace("Z", "+00:00"))
        e = dt.datetime.fromisoformat(a["ends_at"].replace("Z", "+00:00"))
        paid = (e - s).total_seconds() / 60 - a["break_minutes"]
        rate = max(r for r in sorted(rates[a["staff_id"]]) if r[0] <= a["business_date"])[1]
        day = dt.date.fromisoformat(a["business_date"])
        week[(day - dt.timedelta(days=day.isoweekday() - 1)).isoformat()] += paid * rate / 60
    truth = gt["labour_cost_pence_per_week"]
    assert set(week) == set(truth)
    for k, v in truth.items():
        assert abs(week[k] - v) < 0.02, k


def test_pay_rates_follow_the_minimum_wage(built):
    from synth.staff import min_wage
    rows = built["halal_ilford"]["rows"]
    bands = {s["id"]: s["age_band"] for s in rows["staff"]}
    for p in rows["staff_pay_rates"]:
        assert p["hourly_pence"] >= min_wage(bands[p["staff_id"]], dt.date.fromisoformat(p["effective_from"]))
    froms = {p["effective_from"] for p in rows["staff_pay_rates"]}
    assert {"2025-04-01", "2026-04-01"} <= froms


def test_invoices_track_ingredient_use_plus_waste(built):
    rows, gt = built["halal_ilford"]["rows"], built["halal_ilford"]["gt"]
    ing_name = {i["id"]: i["name"] for i in rows["ingredients"]}
    bought = collections.Counter()
    for ln in rows["invoice_lines"]:
        bought[ing_name[ln["ingredient_id"]]] += ln["quantity_std"]
    for key, t in gt["ingredients"].items():
        # The identity holds exactly for every ingredient.
        lhs = t["bought"]
        rhs = t["used_incl_prep_waste"] + t["spoilage_waste"] + t["stock_close"] - t["stock_open"]
        assert abs(lhs - rhs) <= 1e-6 * max(1, lhs) + 0.01, key
        assert abs(bought[t["name"]] - t["bought"]) < 0.01, key
        if t["used_incl_prep_waste"] > 0:
            # And over two years, purchases are within a few % of use plus waste (stock moves are small).
            ratio = t["bought"] / (t["used_incl_prep_waste"] + t["spoilage_waste"])
            assert 0.97 < ratio < 1.08, (key, ratio)
    net, vat = collections.Counter(), collections.Counter()
    for ln in rows["invoice_lines"]:
        net[ln["invoice_id"]] += ln["line_net_pence"]
        vat[ln["invoice_id"]] += ln["vat_pence"]
    for inv in rows["invoices"]:
        assert (net[inv["id"]], vat[inv["id"]]) == (inv["net_pence"], inv["vat_pence"])
        assert inv["gross_pence"] == inv["net_pence"] + inv["vat_pence"]


def test_deals_have_structured_offers_and_exact_truth(built):
    rows, gt = built["halal_ilford"]["rows"], built["halal_ilford"]["gt"]
    assert 8 <= len(rows["campaigns"]) <= 12
    for c in rows["campaigns"]:
        assert c["offer_details"]["type"] in ("percent_off", "money_off", "free_item", "kids_eat_free", "two_for_one")
    for d in gt["deals"]:
        assert d["net_uplift_pence"] == sum(x["net_uplift_pence"] for x in d["per_day"])
        assert d["net_uplift_pence"] == d["incremental_sales_pence"] - d["baseline_discount_pence"]
    assert "deal_outcomes" not in rows  # measuring deals is the model's job


def test_dish_costs_and_prices_are_in_the_truth(built):
    gt = built["halal_ilford"]["gt"]
    assert 30 <= len(gt["dishes"]) <= 50
    for d in gt["dishes"]:
        assert d["true_cost_pence"] and all(c["cost"] > 0 for c in d["true_cost_pence"])
    rises = [d for d in gt["dishes"] if len(d["prices"]) > 1]
    assert rises, "the April price rise is in the price history"


def test_the_messy_copy(built):
    clean, messy = built["halal_ilford"], built["halal_ilford_messy"]
    log = messy["gt"]["messy"]
    days = {r["day"] for r in messy["rows"]["sales_days"]}
    assert log["missing_days"] and not (set(log["missing_days"]) & days)
    # The restaurant traded on the missing days (the ground truth has their sales).
    import csv
    daily = {r["day"]: r for r in csv.DictReader(open(messy["dir"] / "ground_truth_daily.csv", encoding="utf8"))}
    assert all(int(daily[d]["orders"]) > 0 for d in log["missing_days"])
    # Duplicates: on those days items add up to more than the day.
    item_sum = collections.Counter()
    for r in messy["rows"]["sales_items"]:
        item_sum[r["day"]] += round(r["amount"] * 100)
    gross = {r["day"]: round(r["gross_sales"] * 100) for r in messy["rows"]["sales_days"]}
    dup_days = {d["day"] for d in log["duplicate_item_lines"]} & set(gross)
    assert dup_days and all(item_sum[d] > gross[d] for d in dup_days)
    # Till names to match, all in the answer key.
    assert log["unmatched_till_names"] and all(n in log["till_answer_key"] for n in log["unmatched_till_names"])
    # The closure is recorded; the bad week is not.
    ev = messy["rows"]["restaurant_events"]
    assert any(e["type"] == "refit" for e in ev)
    in_bad_week = lambda e: e["starts_at"][:10] <= "2026-06-07" and (e["ends_at"] or "9999")[:10] >= "2026-06-01"
    assert not any(in_bad_week(e) and e["type"] in ("closure", "partial_closure", "refit", "other") for e in ev)
    assert not any("2025-08-04" <= d <= "2025-08-17" for d in days)  # closed: no sales
    # Same seed: identical to the clean copy before anything changed.
    first = lambda rows: [r for r in rows if r["day"] < "2025-04-07"]
    a = {r["day"]: r["gross_sales"] for r in first(clean["rows"]["sales_days"])}
    b = {r["day"]: r["gross_sales"] for r in first(messy["rows"]["sales_days"])}
    assert all(a[d] == b[d] for d in b)


def test_weather_and_calendar_are_real(built):
    rows = built["halal_ilford"]["rows"]
    assert len(rows["weather_hours"]) == 730 * 24
    issued = [r for r in rows["weather_forecasts"] if r.get("target_day")]
    assert all(r["issued_at"][:10] < r["target_day"] for r in issued)
    names = {r["name"] for r in rows["local_calendar"]}
    assert {"Ramadan", "Eid al-Fitr", "Eid al-Adha", "Christmas Day"} <= names
    assert any("England v Argentina" == r["name"] for r in rows["local_calendar"])
    assert len(rows["prayer_times"]) == 730
    feeds = [r["external_source"] for r in rows["local_calendar"]]
    assert all(f.startswith("synthetic:") for f in feeds)
