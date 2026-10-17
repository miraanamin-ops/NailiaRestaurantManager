"""Turns a simulated dataset into database rows, table by table, in insert order.

Money: pence in the new tables, pounds (2 decimals) in the older sales tables.
Every new-table row has source = 'synthetic'; the older tables (sales_*, weather_days,
drafts, campaigns) can't say that, so they use is_dummy = true / source 'seed'
(or 'archive' for weather) and are cleared by restaurant id.
"""

from __future__ import annotations

import datetime as dt
import re

from .ids import uid
from .menu import OPENED
from .outside.calendar import distance_m, venues
from .datasets import PLACES
from .timeutil import LONDON, UTC, iso, london, trading_hour_start

SYN = "synthetic"
# Insert order (parents first). The loader and the PGlite test both follow it.
TABLE_ORDER = [
    "restaurants", "venues", "menu_sections", "dishes", "dish_prices", "ingredients", "recipe_versions", "recipe_lines",
    "till_item_matches", "suppliers", "invoices", "invoice_lines", "ingredient_prices", "fixed_costs", "targets", "channel_fees",
    "staff", "staff_pay_rates", "staff_availability", "staff_time_off", "cover_rules", "rota_weeks", "rota_shifts", "shift_actuals",
    "drafts", "campaigns", "restaurant_events", "sales_days", "sales_hours", "sales_items", "sales_channel_splits",
    "weather_days", "weather_hours", "weather_forecasts", "local_calendar", "football_fixtures", "restaurant_teams",
    "calendar_relevance", "prayer_times",
]


def pounds(p: int | float) -> float:
    return round(p / 100.0, 2)


def d_(x: dt.date) -> str:
    return x.isoformat()


def build(sim, staffing, costs) -> dict[str, list[dict]]:
    cfg, menu = sim.cfg, sim.menu
    R = cfg["id"]
    key = cfg["key"]
    T: dict[str, list[dict]] = {t: [] for t in TABLE_ORDER}
    lat, lon = PLACES[cfg["place"]]
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    hours_json = {}
    for wd, (o, c) in cfg["hours"].items():
        hours_json[day_names[wd - 1]] = f"{o % 24:02d}:00–{c % 24:02d}:00"
    T["restaurants"].append({
        "id": R, "name": cfg["name"], "slug": cfg["slug"], "cuisine": cfg["cuisine"], "address": cfg["address"],
        "opening_hours": hours_json, "latitude": lat, "longitude": lon, "council_name": cfg["council"]["name"],
        "council_code": cfg["council"]["code"], "nation": "england", "prayer_method": cfg["prayer_method"],
        "is_demo": True, "active": False, "trading_day_cutoff": cfg["trading_day_cutoff"] + ":00",
    })

    # --- venues (shared; same ids in every dataset) ---------------------------
    venue_ids = {}
    for v in venues():
        vid = uid("venue", v["key"])
        venue_ids[v["key"]] = vid
        T["venues"].append({"id": vid, "name": v["name"], "kind": v["kind"], "latitude": v["latitude"], "longitude": v["longitude"],
                            "capacity": v["capacity"], "teams": v["teams"], "source": SYN})

    # --- menu ---------------------------------------------------------------
    sec_ids = {}
    for i, s in enumerate(menu.sections):
        sec_ids[s] = uid(key, "section", s)
        T["menu_sections"].append({"id": sec_ids[s], "restaurant_id": R, "name": s, "position": i, "active_from": d_(OPENED), "source": SYN})
    pos: dict[str, int] = {}
    for dish in menu.dishes:
        pos[dish.section] = pos.get(dish.section, -1) + 1
        T["dishes"].append({"id": dish.id, "restaurant_id": R, "section_id": sec_ids[dish.section], "name": dish.name,
                            "position": pos[dish.section], "active_from": d_(dish.active_from or OPENED), "source": SYN})
        for f, p in dish.prices:
            T["dish_prices"].append({"id": uid(key, "dish-price", dish.name, f), "restaurant_id": R, "dish_id": dish.id, "price_pence": p,
                                     "effective_from": d_(f), "recorded_at": iso(london(f - dt.timedelta(days=3), 10)), "source": SYN})
    for k, (name, unit, cat, *_rest) in menu.ingredients.items():
        T["ingredients"].append({"id": costs.ing_ids[k], "restaurant_id": R, "name": name, "unit": unit, "category": cat, "source": SYN})
    for dish in menu.dishes:
        vid = uid(key, "recipe", dish.name)
        T["recipe_versions"].append({"id": vid, "restaurant_id": R, "dish_id": dish.id, "effective_from": d_(dish.active_from or OPENED),
                                     "recorded_at": iso(london(dish.active_from or OPENED, 9)), "portions": 1, "source": SYN,
                                     "confirmed_at": iso(london(dish.active_from or OPENED, 9)), "confirmed_by": "owner"})
        for j, (ing, q, w) in enumerate(dish.recipe):
            T["recipe_lines"].append({"id": uid(key, "recipe-line", dish.name, j), "restaurant_id": R, "recipe_version_id": vid,
                                      "ingredient_id": costs.ing_ids[ing], "quantity": q, "waste_pct": w, "position": j})
    for dish in menu.dishes:
        T["till_item_matches"].append({"id": uid(key, "till", dish.till_name), "restaurant_id": R, "till_name": dish.till_name,
                                       "dish_id": dish.id, "is_dish": True, "confidence": 1, "method": "owner", "source": SYN,
                                       "confirmed_at": iso(london(OPENED, 12)), "confirmed_by": "owner"})
    T["till_item_matches"].append({"id": uid(key, "till", "REFUND"), "restaurant_id": R, "till_name": "REFUND", "dish_id": None,
                                   "is_dish": False, "confidence": 1, "method": "owner", "source": SYN,
                                   "confirmed_at": iso(london(OPENED, 12)), "confirmed_by": "owner"})

    # --- suppliers, invoices, prices ----------------------------------------
    for skey, (name, cat, wday) in menu.suppliers.items():
        T["suppliers"].append({"id": costs.supplier_ids[skey], "restaurant_id": R, "name": name, "category": cat,
                               "notes": f"Delivers on {day_names[wday - 1]}s", "source": SYN})
    for inv in costs.invoices:
        T["invoices"].append({"id": inv["id"], "restaurant_id": R, "supplier_id": costs.supplier_ids[inv["supplier"]],
                              "invoice_number": inv["number"], "invoice_date": d_(inv["date"]), "net_pence": inv["net"],
                              "vat_pence": inv["vat"], "gross_pence": inv["gross"], "status": "saved", "source": SYN,
                              "confirmed_at": iso(london(inv["date"], 15)), "confirmed_by": "owner"})
    for ln in costs.lines:
        T["invoice_lines"].append({"id": ln["id"], "restaurant_id": R, "invoice_id": ln["invoice"], "position": ln["position"],
                                   "description": ln["description"], "quantity": ln["quantity"], "unit_text": _unit_text(ln["description"]),
                                   "quantity_std": ln["quantity_std"], "line_net_pence": ln["net"], "vat_pence": ln["vat"],
                                   "ingredient_id": costs.ing_ids[ln["ingredient"]], "match_confidence": 1, "match_method": "owner"})
    for p in costs.price_rows:
        T["ingredient_prices"].append({"id": p["id"], "restaurant_id": R, "ingredient_id": costs.ing_ids[p["ingredient"]],
                                       "price_pence": p["pence"], "pack_quantity": p["pack"], "effective_from": d_(p["from"]),
                                       "recorded_at": iso(london(p["from"], 15)), "supplier_id": costs.supplier_ids[p["supplier"]],
                                       "invoice_line_id": p["line"], "source": SYN})
    for f in costs.fixed_costs():
        T["fixed_costs"].append({"id": f["id"], "restaurant_id": R, "name": f["name"], "category": f["category"], "amount_pence": f["pence"],
                                 "frequency": f["frequency"], "effective_from": d_(f["from"]), "effective_to": d_(f["to"]) if f["to"] else None,
                                 "recorded_at": iso(london(f["from"], 9)), "source": SYN})
    for t in costs.targets():
        T["targets"].append({"id": t["id"], "restaurant_id": R, "metric": t["metric"], "value": t["value"], "effective_from": d_(t["from"]),
                             "recorded_at": iso(london(t["from"], 9)), "source": SYN})
    for c in costs.channel_fees():
        T["channel_fees"].append({"id": c["id"], "restaurant_id": R, "channel": c["channel"], "fee_pct": c["pct"],
                                  "fee_per_order_pence": c["per_order"], "effective_from": d_(c["from"]),
                                  "effective_to": d_(c["to"]) if c["to"] else None, "recorded_at": iso(london(c["from"], 9)),
                                  "notes": c["notes"], "source": SYN})

    # --- staff and rotas ----------------------------------------------------
    for s in staffing.staff:
        T["staff"].append({"id": s["id"], "restaurant_id": R, "display_name": s["name"], "roles": s["roles"], "skills": s["skills"],
                           "contracted_hours": s["contracted"], "employment_start": d_(s["start"]),
                           "employment_end": d_(s["end"]) if s["end"] else None, "age_band": s["band"],
                           "age_band_set_on": d_(s["start"]), "source": SYN})
    for p in staffing.pay:
        T["staff_pay_rates"].append({"id": uid(key, "pay", p["staff"], p["from"]), "restaurant_id": R, "staff_id": p["staff"],
                                     "hourly_pence": p["pence"], "effective_from": d_(p["from"]),
                                     "recorded_at": iso(london(p["from"] - dt.timedelta(days=7), 10)), "source": SYN})
    for i, a in enumerate(staffing.availability):
        s = next(x for x in staffing.staff if x["id"] == a["staff"])
        T["staff_availability"].append({"id": uid(key, "avail", a["staff"], a["weekday"]), "restaurant_id": R, "staff_id": a["staff"],
                                        "weekday": a["weekday"], "starts": a["starts"], "ends": a["ends"], "kind": a["kind"],
                                        "effective_from": d_(s["start"]), "source": SYN})
    for t in staffing.time_off:
        T["staff_time_off"].append({"id": uid(key, "off", t["staff"], t["start"], t["kind"]), "restaurant_id": R, "staff_id": t["staff"],
                                    "starts_at": iso(london(t["start"])), "ends_at": iso(london(t["end"])), "kind": t["kind"],
                                    "status": t["status"], "source": SYN})
    for i, c in enumerate(staffing.cover_rules):
        T["cover_rules"].append({"id": uid(key, "cover", i), "restaurant_id": R, "role": c["role"], "weekday": c["weekday"],
                                 "starts": c["starts"], "ends": c["ends"], "min_staff": c["min_staff"],
                                 "covers_per_staff": c["covers_per_staff"], "effective_from": d_(OPENED), "source": SYN})
    week_ids = {}
    for w in staffing.weeks:
        week_ids[w] = uid(key, "rota-week", w)
        approved = london(w - dt.timedelta(days=4), 16)
        T["rota_weeks"].append({"id": week_ids[w], "restaurant_id": R, "week_start": d_(w), "status": "published",
                                "approved_at": iso(approved), "approved_by": "owner", "published_at": iso(approved + dt.timedelta(hours=1)), "source": SYN})
    for sh in staffing.shifts:
        T["rota_shifts"].append({"id": sh["id"], "restaurant_id": R, "rota_week_id": week_ids[sh["week"]], "staff_id": sh["staff"],
                                 "role": sh["role"], "business_date": d_(sh["day"]), "starts_at": iso(sh["start"]), "ends_at": iso(sh["end"]),
                                 "break_minutes": sh["break"], "notes": None if sh["staff"] else "Open shift", "source": SYN})
    for a in staffing.actuals:
        T["shift_actuals"].append({"id": a["id"], "restaurant_id": R, "staff_id": a["staff"], "rota_shift_id": a["shift"], "role": a["role"],
                                   "business_date": d_(a["day"]), "starts_at": iso(a["start"]), "ends_at": iso(a["end"]),
                                   "break_minutes": a["break"], "source": SYN})

    # --- campaigns (drafts first: campaigns.draft_id is required) ------------
    for c in sim.campaigns:
        sent = london(c["valid_from"] - dt.timedelta(days=1), 10)
        body = f"Hi {{first_name}}, {c['offer']['description']} from {c['valid_from']:%A %d %B} to {c['valid_until']:%A %d %B}."
        T["drafts"].append({"id": c["draft_id"], "restaurant_id": R, "kind": "email_campaign", "content": body, "status": "sent",
                            "created_at": iso(sent - dt.timedelta(hours=20)), "approved_at": iso(sent - dt.timedelta(hours=2)), "sent_at": iso(sent)})
        T["campaigns"].append({"id": c["id"], "restaurant_id": R, "draft_id": c["draft_id"], "name": c["name"], "subject": c["offer"]["description"],
                               "body": body, "offer": c["offer"]["description"], "valid_from": d_(c["valid_from"]), "valid_until": d_(c["valid_until"]),
                               "segment": c["segment"], "is_birthday": False, "sent_at": iso(sent), "send_at": iso(sent),
                               "eligible_count": c["eligible"], "excluded_count": int(c["eligible"] * 0.08), "offer_details": c["offer"],
                               "created_at": iso(sent - dt.timedelta(hours=20))})
        T["restaurant_events"].append({"id": uid(key, "event-campaign", c["id"]), "restaurant_id": R, "type": "promotion",
                                       "starts_at": iso(london(c["valid_from"])), "ends_at": iso(london(c["valid_until"] + dt.timedelta(days=1))),
                                       "treat_as_unusual": False, "campaign_id": c["id"], "notes": c["name"], "source": SYN, "created_by": "system"})

    # --- the restaurant's own events ----------------------------------------
    for r in sim.results:
        if r.closed == "closed_day":
            T["restaurant_events"].append({"id": uid(key, "event-closed", r.day), "restaurant_id": R, "type": "closure",
                                           "starts_at": iso(london(r.day)), "ends_at": iso(london(r.day + dt.timedelta(days=1))),
                                           "treat_as_unusual": False, "notes": "Closed (holiday)", "source": SYN, "created_by": "owner"})
    for c in cfg["closures"]:
        a, b = dt.date.fromisoformat(c["start"]), dt.date.fromisoformat(c["end"])
        T["restaurant_events"].append({"id": uid(key, "event-closure", a), "restaurant_id": R, "type": c["type"],
                                       "starts_at": iso(london(a)), "ends_at": iso(london(b + dt.timedelta(days=1))),
                                       "treat_as_unusual": True, "notes": c["note"], "source": SYN, "created_by": "owner"})
    for p in cfg["price_rises"]:
        day = dt.date.fromisoformat(p["day"])
        T["restaurant_events"].append({"id": uid(key, "event-price", day), "restaurant_id": R, "type": "price_change",
                                       "starts_at": iso(london(day)), "ends_at": None, "treat_as_unusual": False,
                                       "notes": f"Prices up {round(p['pct'] * 100)}% on {', '.join(p['sections'])}: {p['note']}", "source": SYN, "created_by": "owner"})
    for n in cfg["new_dishes"]:
        day = dt.date.fromisoformat(n["launch"])
        T["restaurant_events"].append({"id": uid(key, "event-launch", n["name"]), "restaurant_id": R, "type": "menu_change",
                                       "starts_at": iso(london(day)), "ends_at": None, "treat_as_unusual": False,
                                       "notes": f"New dish: {n['name']}", "source": SYN, "created_by": "owner"})
    open_shifts = {}
    for sh in staffing.shifts:
        if not sh["staff"]:
            open_shifts[sh["day"]] = open_shifts.get(sh["day"], 0) + 1
    for day, n in sorted(open_shifts.items()):
        if n >= 2:
            T["restaurant_events"].append({"id": uid(key, "event-short", day), "restaurant_id": R, "type": "short_staffed",
                                           "starts_at": iso(london(day)), "ends_at": iso(london(day + dt.timedelta(days=1))),
                                           "treat_as_unusual": False, "notes": f"{n} shifts not filled", "source": SYN, "created_by": "system"})

    # --- sales --------------------------------------------------------------
    cut = int(cfg["trading_day_cutoff"][:2])
    for r in sim.results:
        if r.closed or not r.orders:
            continue
        net = round(r.gross / 1.2)
        T["sales_days"].append({"restaurant_id": R, "day": d_(r.day), "net_sales": pounds(net), "gross_sales": pounds(r.gross),
                                "vat": pounds(r.gross - net), "transactions": r.orders, "card": pounds(r.card), "cash": pounds(r.cash),
                                "discounts": pounds(r.discounts), "refunds": pounds(r.refunds), "net_estimated": False, "source": "seed",
                                "is_dummy": True, "covers": r.covers, "covers_source": SYN})
        for h, (sales, orders, covers) in sorted(r.hours.items()):
            T["sales_hours"].append({"restaurant_id": R, "day": d_(r.day), "hour": h % 24, "sales": pounds(sales), "transactions": orders,
                                     "source": "seed", "is_dummy": True, "covers": covers, "covers_source": SYN})
        for di, (qty, amt) in sorted(r.items.items()):
            till = menu.dishes[di].till_name
            T["sales_items"].append({"restaurant_id": R, "day": d_(r.day), "hour": None, "item": till, "quantity": qty, "amount": pounds(amt),
                                     "row_key": f"synthetic:{r.day}:{till}", "is_dummy": True})
        if r.refund_line:
            T["sales_items"].append({"restaurant_id": R, "day": d_(r.day), "hour": None, "item": "REFUND", "quantity": 1,
                                     "amount": pounds(r.refund_line), "row_key": f"synthetic:{r.day}:REFUND", "is_dummy": True})
        by_ch: dict[str, list[int]] = {}
        for (h, ch), (sales, orders, covers) in sorted(r.channels.items()):
            T["sales_channel_splits"].append({"id": uid(key, "split", r.day, h, ch), "restaurant_id": R, "day": d_(r.day), "hour": h % 24,
                                              "channel": ch, "sales_pence": sales, "includes_vat": True, "orders": orders,
                                              "covers": covers if ch == "dine_in" else None, "source": SYN})
            t = by_ch.setdefault(ch, [0, 0, 0])
            t[0] += sales; t[1] += orders; t[2] += covers
        for ch, (sales, orders, covers) in by_ch.items():
            T["sales_channel_splits"].append({"id": uid(key, "split", r.day, "day", ch), "restaurant_id": R, "day": d_(r.day), "hour": None,
                                              "channel": ch, "sales_pence": sales, "includes_vat": True, "orders": orders,
                                              "covers": covers if ch == "dine_in" else None, "source": SYN})

    # --- weather ------------------------------------------------------------
    wd = sim.wd
    for day in wd.index:
        if not (sim.start <= day <= sim.end):
            continue
        w = wd.loc[day]
        T["weather_days"].append({"restaurant_id": R, "day": d_(day), "temp_max": round(float(w.temp_max), 1), "temp_min": round(float(w.temp_min), 1),
                                  "temp_mean": round(float(w.temp_mean), 1), "rain_mm": round(float(w.rain_mm), 1), "weather_code": int(w.weather_code),
                                  "conditions": w.conditions, "source": "archive", "fetched_at": iso(london(day + dt.timedelta(days=5), 6)),
                                  "sunshine_hours": round(float(w.sunshine_hours), 1)})
    lo = london(sim.start).astimezone(UTC)
    hi = london(sim.end + dt.timedelta(days=1)).astimezone(UTC)
    wh = sim.wh[(sim.wh["hour_start"] >= lo) & (sim.wh["hour_start"] < hi)]
    for row in wh.itertuples(index=False):
        T["weather_hours"].append({"id": uid(key, "wh", row.hour_start.isoformat()), "restaurant_id": R, "hour_start": iso(row.hour_start.to_pydatetime()),
                                   "temp": _r1(row.temp), "rain_mm": _r1(row.rain_mm), "weather_code": _int(row.weather_code),
                                   "cloud_pct": _int(row.cloud_pct), "wind_kmh": _r1(row.wind_kmh), "sunshine_min": _int(row.sunshine_min),
                                   "provider": "open-meteo", "source": SYN, "fetched_at": iso(row.hour_start.to_pydatetime() + dt.timedelta(days=5))})
    fc = sim.fc[(sim.fc["hour_start"] >= lo) & (sim.fc["hour_start"] < hi) & (sim.fc["lead"] <= 2)]
    for row in fc.itertuples(index=False):
        if row.temp != row.temp:  # NaN
            continue
        t = row.hour_start.to_pydatetime()
        T["weather_forecasts"].append({"id": uid(key, "wf-h", t.isoformat(), row.lead), "restaurant_id": R,
                                       "issued_at": iso(t - dt.timedelta(days=int(row.lead))), "hour_start": iso(t),
                                       "temp": _r1(row.temp), "rain_mm": _r1(row.rain_mm), "sunshine_min": _int(row.sunshine_min),
                                       "provider": "open-meteo previous runs (ecmwf_ifs025)", "source": SYN})
    for row in sim.fcd.itertuples(index=False):
        if not (sim.start <= row.day <= sim.end):
            continue
        T["weather_forecasts"].append({"id": uid(key, "wf-d", row.day, row.lead), "restaurant_id": R, "issued_at": iso(row.issued_at),
                                       "target_day": d_(row.day), "temp_max": _r1(row.temp_max), "temp_min": _r1(row.temp_min),
                                       "rain_mm": _r1(row.rain_mm), "sunshine_hours": _r1(row.sunshine_hours),
                                       "provider": "open-meteo previous runs (ecmwf_ifs025)", "source": SYN})

    # --- the outside calendar (this restaurant's own copy) -------------------
    football = cfg["effects"]["football"]
    for e in sim.events:
        eid = uid(key, "cal", e["external_source"], e["external_id"])
        T["local_calendar"].append({
            "id": eid, "restaurant_id": R, "day": d_(e["day"]), "end_day": d_(e["end_day"]) if e["end_day"] else None, "name": e["name"],
            "type": e["type"], "date_uncertain": e["date_uncertain"], "source": SYN,
            "starts_at": iso(e["starts_at"]) if e["starts_at"] else None, "ends_at": iso(e["ends_at"]) if e["ends_at"] else None,
            "scope": e["scope"], "region": e["region"], "council_code": e["council_code"],
            "latitude": e["latitude"], "longitude": e["longitude"], "venue_id": venue_ids.get(e["venue"]) if e["venue"] else None,
            "expected_size": e["expected_size"], "external_source": f"synthetic:{e['external_source']}",
            "external_id": f"{key}:{e['external_id']}", "notes": e["notes"]})
        if e["fixture"]:
            fx = e["fixture"]
            T["football_fixtures"].append({"id": uid(key, "fixture", e["external_id"]), "event_id": eid, "competition": fx["competition"],
                                           "home_team": fx["home"], "away_team": fx["away"], "kickoff_at": iso(fx["kickoff"]),
                                           "venue_id": venue_ids.get(e["venue"]) if e["venue"] else None,
                                           "external_source": f"synthetic:{e['external_source']}", "external_id": f"{key}:{e['external_id']}", "source": SYN})
        dist = distance_m(lat, lon, e["latitude"], e["longitude"]) if e["latitude"] is not None else None
        relevant = _relevant(cfg, e, football)
        T["calendar_relevance"].append({"id": uid(key, "rel", eid), "restaurant_id": R, "event_id": eid, "distance_m": dist,
                                        "relevant": relevant, "marked_by": "builder" if relevant is not None else None,
                                        "marked_at": iso(london(sim.start, 9)) if relevant is not None else None,
                                        "computed_at": iso(london(sim.start, 9)), "source": SYN})
    for team in cfg["team"]:
        T["restaurant_teams"].append({"id": uid(key, "team", team), "restaurant_id": R, "team": team,
                                      "why": "local club" if team == "West Ham" else "big following among customers", "source": SYN})
    for day, p in sorted(sim.prayer.items()):
        T["prayer_times"].append({"id": uid(key, "prayer", day), "restaurant_id": R, "day": d_(day),
                                  **{k: iso(v) for k, v in p.items()}, "method": cfg["prayer_method"], "source": SYN})
    return T


def _relevant(cfg, e, football):
    """What the builder marked: True where the dataset has an effect for this kind of event, False where it has none."""
    eff = cfg["effects"]
    k = e["kind"]
    if k == "premier_league":
        teams = {e["fixture"]["home"], e["fixture"]["away"]}
        return bool(teams & set(football["teams"])) or (e.get("venue") is not None and eff["venue"]["max_lift"] > 0)
    if k == "england":
        return football["england"] != 1.0
    if k == "venue":
        return eff["venue"]["max_lift"] > 0
    if k in ("ramadan", "eid_fitr", "eid_adha"):
        return eff.get("ramadan") is not None
    if k == "school_holiday":
        return eff["school_holiday"] != 1.0 or eff["school_holiday_lunch"] != 1.0
    if k == "payday":
        return eff["payday"] != 1.0
    if k == "bank_holiday":
        return eff["bank_holiday"] != 1.0
    return None


def _unit_text(desc: str) -> str:
    m = re.search(r"(\d+(?:\.\d+)?\s?(?:kg|g|L|ml|in)(?:\s?x\s?\d+)?|x\s?\d+)\s*(?:frozen|tub|sack|drum|wedge|block)?$", desc)
    return m.group(1) if m else "each"


def _r1(x):
    return None if x is None or x != x else round(float(x), 1)


def _int(x):
    return None if x is None or x != x else int(x)
