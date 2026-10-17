"""Past email campaigns with structured offers (campaigns.offer_details) and their
true effect. The model must estimate the uplift; the truth is only in ground_truth.json.

Each campaign, while valid, multiplies expected orders in its target slots by
(1 + uplift). The extra orders are marked as incremental (Poisson thinning), so
the true incremental sales and the discount given to customers who would have
come anyway are both known exactly.
"""

from __future__ import annotations

import datetime as dt

from .ids import uid

# Per menu: name, offer type, details, target weekdays (1 = Monday), hours, channels, true uplift, redemption.
#   hours: "lunch" (11 to 15), "evening" (17 onwards), "all"
#   redemption: share of the orders that would have come anyway that use the offer
TEMPLATES = {
    "south_asian": [
        ("Quiet Tuesday grill night", "percent_off", {"discount_percent": 20, "sections": ["Grills"], "description": "20% off all grills"}, [2], "evening", ["dine_in"], 0.22, 0.10),
        ("Midweek family deal", "kids_eat_free", {"description": "Kids eat free with every adult main"}, [1, 2, 3], "all", ["dine_in"], 0.12, 0.06),
        ("Free mango lassi", "free_item", {"item": "Mango Lassi", "description": "A free Mango Lassi with any main"}, [1, 2, 3, 4], "all", ["dine_in", "takeaway"], 0.08, 0.08),
        ("Biryani Monday", "percent_off", {"discount_percent": 15, "sections": ["Biryani"], "description": "15% off biryani"}, [1], "all", ["dine_in", "takeaway", "delivery"], 0.18, 0.09),
        ("Lunch for two", "two_for_one", {"description": "Two mains for the price of one at lunch"}, [1, 2, 3, 4, 5], "lunch", ["dine_in"], 0.35, 0.12),
        ("£5 off orders over £30", "money_off", {"discount_value_gbp": 5, "min_order_gbp": 30, "description": "£5 off when you spend £30"}, [1, 2, 3, 4], "evening", ["takeaway"], 0.10, 0.07),
        ("Ramadan iftar offer", "percent_off", {"discount_percent": 10, "sections": None, "description": "10% off iftar for groups"}, [1, 2, 3, 4, 5, 6, 7], "evening", ["dine_in"], 0.06, 0.15),
        ("Thursday karahi night", "percent_off", {"discount_percent": 20, "sections": ["Mains"], "description": "20% off karahi and curries"}, [4], "evening", ["dine_in", "takeaway"], 0.15, 0.10),
        ("Free dessert", "free_item", {"item": "Gulab Jamun", "description": "Free gulab jamun with every meal"}, [1, 2, 3], "evening", ["dine_in"], 0.05, 0.10),
        ("Weekend lunch special", "money_off", {"discount_value_gbp": 4, "min_order_gbp": 25, "description": "£4 off lunch over £25"}, [6, 7], "lunch", ["dine_in"], 0.09, 0.08),
    ],
    "cafe": [
        ("Midweek brunch", "percent_off", {"discount_percent": 20, "sections": ["Brunch"], "description": "20% off brunch Monday to Wednesday"}, [1, 2, 3], "all", ["dine_in"], 0.18, 0.10),
        ("Free pastry with coffee", "free_item", {"item": "Croissant", "description": "A free croissant with any coffee"}, [1, 2, 3, 4, 5], "all", ["dine_in", "takeaway"], 0.07, 0.08),
        ("Kids eat free half term", "kids_eat_free", {"description": "Kids eat free with an adult brunch"}, [1, 2, 3, 4, 5], "all", ["dine_in"], 0.14, 0.12),
        ("Two coffees for one", "two_for_one", {"description": "Two coffees for the price of one"}, [1, 2], "all", ["dine_in", "takeaway"], 0.25, 0.08),
        ("£3 off lunch", "money_off", {"discount_value_gbp": 3, "min_order_gbp": 15, "description": "£3 off lunch over £15"}, [1, 2, 3, 4], "lunch", ["dine_in"], 0.12, 0.07),
        ("Afternoon cake hour", "percent_off", {"discount_percent": 25, "sections": ["Cakes and pastries"], "description": "25% off cakes after 2pm"}, [1, 2, 3, 4, 5], "all", ["dine_in", "takeaway"], 0.10, 0.10),
        ("Rainy day latte", "percent_off", {"discount_percent": 15, "sections": ["Coffee"], "description": "15% off coffee"}, [1, 2, 3, 4, 5], "all", ["dine_in", "takeaway"], 0.06, 0.12),
        ("Weekday lunch club", "percent_off", {"discount_percent": 15, "sections": ["Lunch"], "description": "15% off lunch dishes"}, [1, 2, 3, 4, 5], "lunch", ["dine_in"], 0.16, 0.09),
        ("Free kids pancakes", "free_item", {"item": "Kids Pancakes", "description": "Free kids pancakes with any brunch"}, [6, 7], "all", ["dine_in"], 0.05, 0.06),
        ("Smoothie launch", "percent_off", {"discount_percent": 30, "sections": ["Cold drinks"], "description": "30% off smoothies and juices"}, [1, 2, 3, 4, 5, 6, 7], "all", ["dine_in", "takeaway"], 0.04, 0.10),
    ],
    "takeaway": [
        ("Wing Wednesday", "two_for_one", {"description": "Two wings for one on Wednesdays"}, [3], "all", ["takeaway", "delivery"], 0.30, 0.12),
        ("£5 off £25", "money_off", {"discount_value_gbp": 5, "min_order_gbp": 25, "description": "£5 off orders over £25"}, [1, 2, 3, 4], "all", ["delivery"], 0.12, 0.08),
        ("Free fries", "free_item", {"item": "Fries", "description": "Free fries with any burger"}, [1, 2], "all", ["takeaway", "delivery"], 0.09, 0.10),
        ("Pizza Monday", "percent_off", {"discount_percent": 25, "sections": ["Pizza"], "description": "25% off pizza"}, [1], "all", ["takeaway", "delivery"], 0.20, 0.09),
        ("Late night deal", "percent_off", {"discount_percent": 15, "sections": None, "description": "15% off after 10pm"}, [1, 2, 3, 4, 5, 6, 7], "evening", ["delivery"], 0.07, 0.10),
        ("Family bucket weekend", "money_off", {"discount_value_gbp": 6, "min_order_gbp": 27, "description": "£6 off the family bucket"}, [5, 6, 7], "all", ["takeaway", "delivery"], 0.08, 0.06),
        ("Match day meal", "percent_off", {"discount_percent": 20, "sections": ["Meal deals"], "description": "20% off meal deals on match days"}, [6, 7], "all", ["takeaway", "delivery"], 0.10, 0.12),
        ("Student Tuesday", "percent_off", {"discount_percent": 20, "sections": None, "description": "20% off for students on Tuesdays"}, [2], "all", ["takeaway"], 0.15, 0.08),
        ("Free drink", "free_item", {"item": "Soft Drink (can)", "description": "Free can with any main"}, [1, 2, 3, 4], "all", ["takeaway", "delivery"], 0.05, 0.10),
        ("Kids pizza free", "kids_eat_free", {"description": "Free 9in pizza with a 12in"}, [6, 7], "all", ["takeaway"], 0.06, 0.05),
    ],
}


def campaigns(cfg: dict, start: dt.date, end: dt.date, ramadan_days: set[dt.date]) -> list[dict]:
    """Ten campaigns spread over the window (each 7 to 14 days, starting on a Monday),
    avoiding closures. The Ramadan offer runs in the first Ramadan of the window."""
    temps = TEMPLATES[cfg["menu"]]
    closures = [(dt.date.fromisoformat(c["start"]), dt.date.fromisoformat(c["end"])) for c in cfg["closures"]]
    span = (end - start).days
    out = []
    for k, (name, typ, det, weekdays, hours, chans, uplift, redemption) in enumerate(temps):
        length = 28 if typ in ("percent_off", "two_for_one") else 14
        if "Ramadan" in name and ramadan_days:
            first = min(ramadan_days)
            vf = first + dt.timedelta(days=7)
            length = 14
        else:
            vf = start + dt.timedelta(days=int(span * (k + 0.5) / len(temps)))
            vf -= dt.timedelta(days=vf.isoweekday() - 1)
        vu = vf + dt.timedelta(days=length - 1)
        taken = [(c["valid_from"], c["valid_until"]) for c in out]
        while any(not (vu < a or vf > b) for a, b in closures + taken) or vu > end - dt.timedelta(days=3):
            vf -= dt.timedelta(days=21)
            vu -= dt.timedelta(days=21)
        if vf < start:
            continue
        offer = {
            "type": typ, "description": det["description"],
            "items": [det["item"]] if det.get("item") else [],
            "applies_to": None, "discount_percent": det.get("discount_percent"),
            "discount_value_gbp": det.get("discount_value_gbp"),
            "valid_from": vf.isoformat(), "valid_to": vu.isoformat(),
            "conditions": f"Minimum order £{det['min_order_gbp']}" if det.get("min_order_gbp") else "",
        }
        out.append({
            "id": uid(cfg["key"], "campaign", k), "draft_id": uid(cfg["key"], "campaign-draft", k), "index": k,
            "name": name, "type": typ, "details": det, "offer": offer, "valid_from": vf, "valid_until": vu,
            "weekdays": weekdays, "hours": hours, "channels": chans, "uplift": uplift, "redemption": redemption,
            "segment": "everyone", "eligible": 300 + 97 * k % 900,
        })
    return out


def slot_matches(c: dict, d: dt.date, hour_index: int, channel: str) -> bool:
    if not (c["valid_from"] <= d <= c["valid_until"]) or d.isoweekday() not in c["weekdays"] or channel not in c["channels"]:
        return False
    h = hour_index % 24
    if c["hours"] == "lunch":
        return 11 <= h <= 15
    if c["hours"] == "evening":
        return h >= 17 or hour_index >= 24
    return True
