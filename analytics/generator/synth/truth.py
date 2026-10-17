"""ground_truth.json and ground_truth_daily.csv: exactly what was baked into a dataset."""

from __future__ import annotations

import csv
import datetime as dt
import io

from .costs import PRICE_REVIEW_WEEKS, TARGET_DAYS
from .menus import INFLATION, PRICE_JUMPS
from .sales import ORDER_RULES, REFUND_RATE
from .staff import PAY_RAISE, ROSTERS, TEMPLATES


def _ser(x):
    if isinstance(x, (dt.date, dt.datetime)):
        return x.isoformat()
    if isinstance(x, range):
        return list(x)
    if isinstance(x, dict):
        return {str(k): _ser(v) for k, v in x.items()}
    if isinstance(x, (list, tuple, set)):
        return [_ser(v) for v in x]
    return x


def build(sim, staffing, costs, mess_log: dict | None) -> tuple[dict, str]:
    cfg, menu = sim.cfg, sim.menu
    camp_truth = []
    for c in sim.campaigns:
        tot = {"incremental_orders": 0, "incremental_sales_pence": 0, "incremental_covers": 0, "baseline_orders_in_slots": 0,
               "baseline_discount_pence": 0, "redeemed_orders": 0}
        per_day = []
        for r in sim.results:
            t = r.campaign.get(c["id"])
            if t:
                for k in tot:
                    tot[k] += t[k]
                per_day.append({"day": r.day.isoformat(), "net_uplift_pence": t["incremental_sales_pence"] - t["baseline_discount_pence"], **t})
        camp_truth.append({
            "campaign_id": c["id"], "name": c["name"], "offer": c["offer"], "valid_from": c["valid_from"].isoformat(),
            "valid_until": c["valid_until"].isoformat(), "weekdays": c["weekdays"], "hours": c["hours"], "channels": c["channels"],
            "true_uplift_on_orders": c["uplift"], "redemption_of_baseline_orders": c["redemption"],
            **tot, "net_uplift_pence": tot["incremental_sales_pence"] - tot["baseline_discount_pence"],
            "explain": "net_uplift_pence = sales with the deal minus sales without it = incremental orders' sales (after discount) "
                       "minus the discount given on orders that would have come anyway",
            "per_day": per_day,
        })

    months = []
    d = dt.date(sim.start.year, sim.start.month, 1)
    while d <= sim.end:
        months.append(d)
        d = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    dishes = []
    for dish in menu.dishes:
        change_days = sorted({f for f, _ in dish.prices if f >= sim.start} | set(months))
        dishes.append({
            "dish_id": dish.id, "name": dish.name, "section": dish.section, "till_name": dish.till_name, "role": dish.role,
            "popularity": dish.popularity, "active_from": (dish.active_from or None) and dish.active_from.isoformat(),
            "prices": [{"from": f.isoformat(), "pence": p} for f, p in dish.prices],
            "recipe": [{"ingredient": i, "quantity": q, "prep_waste_pct": w} for i, q, w in dish.recipe],
            "true_cost_pence": [{"day": x.isoformat(), "cost": round(costs.dish_cost(dish, x), 2), "price": dish.price_on(x),
                                 "food_cost_pct": round(100 * costs.dish_cost(dish, x) / (dish.price_on(x) / 1.2), 1)} for x in change_days],
            "units_sold": sum(r.items.get(dish.idx, [0])[0] for r in sim.results),
        })
    ingredients = {}
    for k, v in menu.ingredients.items():
        used = sum(u.get(k, 0.0) for u in costs.use.values())
        ingredients[k] = {
            "name": v[0], "unit": v[1], "category": v[2], "pack": v[3], "supplier": v[5], "spoilage_pct": v[6], "vat_pct": v[8],
            "bought": round(costs.bought.get(k, 0.0), 3), "used_incl_prep_waste": round(used, 3),
            "prep_waste": round(costs.prep_waste.get(k, 0.0), 3), "spoilage_waste": round(costs.waste.get(k, 0.0), 3),
            "stock_open": costs.stock_open[k], "stock_close": costs.stock_close[k],
            "pack_price_path": [{"from": f.isoformat(), "pence": p} for f, p in costs.path[k] if f <= sim.end],
        }
    labour = staffing.labour_cost()
    gt = {
        "dataset": cfg["key"], "restaurant_id": cfg["id"], "restaurant_name": cfg["name"], "seed": sim.seed,
        "window": {"start": sim.start.isoformat(), "end": sim.end.isoformat()},
        "parameters": _ser({k: v for k, v in cfg.items()}),
        "order_rules": ORDER_RULES[cfg["menu"]], "refund_rate_per_day": REFUND_RATE,
        "staff": {"roster": _ser(ROSTERS[cfg["menu"]]), "shift_templates": _ser(TEMPLATES[cfg["menu"]]), "yearly_raise_above_minimum": PAY_RAISE},
        "costs": {"inflation_per_year": INFLATION, "price_jumps": PRICE_JUMPS, "stock_target_days": TARGET_DAYS,
                  "price_review_weeks": PRICE_REVIEW_WEEKS},
        "sunshine_normal_hours_by_month": sim.sun_normal,
        "deals": camp_truth,
        "dishes": dishes,
        "ingredients": ingredients,
        "identity": "for every ingredient: bought = used_incl_prep_waste + spoilage_waste + stock_close - stock_open",
        "labour_cost_pence_per_week": labour["per_week"],
        "working_time_edge_cases": staffing.edge_cases,
        "unexplained_shock_days": [x.isoformat() for x in _shock_days(sim)],
        "event_extras": [{"day": i["day"].isoformat(), **x} for i in sim.days for x in i["extras"]],
        "closed_days": [{"day": r.day.isoformat(), "why": r.closed} for r in sim.results if r.closed],
        "messy": mess_log,
        "approximations": [
            "VAT is 20% on all sales (no zero-rated cold takeaway food).",
            "sales_days.card includes delivery-app payments; cash is only dine-in and takeaway.",
            "Forecast issued_at is the target hour (or the London midnight starting the target day) minus N days; Open-Meteo gives no issue time.",
            "Weather forecasts have no weather code or rain chance (the Previous Runs data has none).",
            "Item sales are per dish per day (sales_items.hour empty); receipt-level detail is only in the POS exports.",
            "Shared venues are not owned by a restaurant; each dataset has its own copy of the calendar and fixtures.",
        ],
    }
    return gt, _daily_csv(sim)


def _shock_days(sim):
    return sim_shocks(sim)


def sim_shocks(sim):
    return [i["day"] for i in sim.days if abs(i["multipliers"]["shock"] - 1) > 1e-9]


def _daily_csv(sim) -> str:
    out = io.StringIO()
    keys = ["trend", "dow", "season", "noise", "shock", "unexplained", "bank_holiday", "christmas_new_year", "ramadan", "eid",
            "chand_raat", "school_holiday", "payday", "price_index", "price_effect"]
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["day", "closed", *keys, "rain_mm_open_hours", "temp_open_hours", "sun_hours", "sun_vs_normal",
                "weather_dine_in", "weather_takeaway", "weather_delivery", "expected_orders_no_deals", "event_extra_orders",
                "events", "campaign_ids", "orders", "gross_pence", "covers"])
    for info, r in zip(sim.days, sim.results):
        m = info["multipliers"]
        exp = sum(sum(v.values()) for v in info["lam"].values())
        w.writerow([info["day"].isoformat(), info["closed"] or "", *[round(m[k], 5) for k in keys],
                    info["weather"]["rain_mm"], info["weather"]["temp"], info["weather"]["sun_hours"], info["weather"]["sun_vs_normal"],
                    round(info["weather_mult"]["dine_in"], 4), round(info["weather_mult"]["takeaway"], 4), round(info["weather_mult"]["delivery"], 4),
                    round(exp, 2), round(sum(x["extra_orders"] for x in info["extras"]), 2),
                    "; ".join(x["name"] for x in info["extras"]), " ".join(r.campaign.keys()), r.orders, r.gross, r.covers])
    return out.getvalue()
