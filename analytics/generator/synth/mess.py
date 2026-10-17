"""Data-quality problems for the messy dataset, applied to the rows after simulation.
The restaurant's real changes (closure, price rise, new dish, bad week) are in the
simulation itself; this only spoils what was recorded. Everything is logged."""

from __future__ import annotations

import numpy as np

from .menus import MESSY_TILL_NAMES


def _typo(name: str, rng) -> str:
    kind = int(rng.integers(0, 4))
    if len(name) < 4:
        return name + "."
    i = int(rng.integers(1, len(name) - 2))
    if kind == 0:
        return name[:i] + name[i + 1] + name[i] + name[i + 2:]    # swapped letters
    if kind == 1:
        return name[:i] + name[i + 1:]                           # dropped letter
    if kind == 2:
        return name.lower()                                      # case
    return name.replace(" ", "  ", 1) if " " in name else name + " "  # extra space


def apply(T: dict, cfg: dict, menu, seed: int) -> dict:
    m = cfg["mess"]
    rng = np.random.default_rng([seed, cfg["seed_offset"], 99])
    log: dict = {}
    by_till = {d.till_name: d for d in menu.dishes}

    # 1. Days whose till report never arrived (the restaurant traded; nothing was recorded).
    days = sorted({r["day"] for r in T["sales_days"]})
    missing = sorted(d for d in days if rng.random() < m["missing_day_rate"])
    ms = set(missing)
    for t in ("sales_days", "sales_hours", "sales_items", "sales_channel_splits"):
        T[t] = [r for r in T[t] if r["day"] not in ms]
    log["missing_days"] = missing

    # 2. The till reprogrammed: new names for some dishes from a day on.
    renamed = 0
    for r in T["sales_items"]:
        if r["day"] >= m["renamed_till_from"] and r["item"] in MESSY_TILL_NAMES:
            r["item"] = MESSY_TILL_NAMES[r["item"]]
            r["row_key"] = f"synthetic:{r['day']}:{r['item']}"
            renamed += 1
    log["renamed_till_from"] = m["renamed_till_from"]
    log["renamed_lines"] = renamed

    # 3. Typos in item names (each a separate till button pressed by mistake... or a bad export).
    answer_key = {d.till_name: d.name for d in menu.dishes} | {new: by_till[old].name for old, new in MESSY_TILL_NAMES.items() if old in by_till}
    typos = []
    for r in T["sales_items"]:
        if r["item"] != "REFUND" and rng.random() < m["typo_rate"]:
            orig = r["item"]
            r["item"] = _typo(orig, rng)
            r["row_key"] = f"synthetic:{r['day']}:{r['item']}:typo"
            answer_key[r["item"]] = answer_key.get(orig, orig)
            typos.append({"day": r["day"], "written": r["item"], "meant": orig})
    log["typos"] = typos

    # 4. Item lines imported twice (so items add up to more than the day's sales on those days).
    dups = []
    extra = []
    for r in T["sales_items"]:
        if rng.random() < m["duplicate_item_rate"]:
            d = dict(r, row_key=r["row_key"] + ":dup")
            extra.append(d)
            dups.append({"day": r["day"], "item": r["item"], "amount": r["amount"]})
    T["sales_items"] += extra
    log["duplicate_item_lines"] = dups

    # 5. Till matches: only names that match a dish exactly are matched; the rest are for the matching feature.
    names_now = {r["item"] for r in T["sales_items"]}
    keep = {d.till_name for d in menu.dishes} | {"REFUND"}
    T["till_item_matches"] = [t for t in T["till_item_matches"] if t["till_name"] in keep]
    log["unmatched_till_names"] = sorted(n for n in names_now if n not in keep)
    log["till_answer_key"] = dict(sorted(answer_key.items()))
    log["note"] = ("The closure, the January price rise, the new dish and the unexplained bad week are real changes in the "
                   "simulation (see parameters). The POS exports also carry broken and repeated rows (inputs/answers.json).")
    return log
