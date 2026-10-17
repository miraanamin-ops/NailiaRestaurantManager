"""Charts showing the baked-in effects are visible in each dataset's data.

  py sanity_plots.py [--dataset all]      -> output/<dataset>/plots/*.png

Effects are measured from the data the way a model would see it: each day compared
with the median of the same weekday in the 3 weeks before and after (event days left
out). Where the truth is known, it is drawn as a marker next to what the data shows.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from synth.datasets import DATASETS

HERE = Path(__file__).resolve().parent
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
INK, INK2, MUTED, GRID, SURFACE, BAND = "#0b0b0b", "#52514e", "#8a8984", "#e4e3df", "#fcfcfb", "#ecebe7"

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2, "text.color": INK,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "axes.spines.top": False, "axes.spines.right": False,
    "font.size": 10, "axes.titlesize": 12, "axes.titleweight": "bold", "axes.titlelocation": "left", "legend.frameon": False,
    "lines.linewidth": 2,
})


def jl(folder: Path, table: str) -> pd.DataFrame:
    f = next(folder.glob(f"*_{table}.jsonl"))
    return pd.DataFrame([json.loads(x) for x in f.read_text(encoding="utf8").splitlines() if x.strip()])


def vs_normal(series: pd.Series, exclude: set) -> pd.Series:
    """Each day / median of the same weekday up to 6 weeks either side (excluding event days)."""
    s = series.copy()
    out = {}
    clean = s[[d not in exclude for d in s.index]]
    for d, v in s.items():
        ref = [clean.get(d + dt.timedelta(days=7 * k)) for k in (-1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6)]
        ref = [x for x in ref if x is not None and not pd.isna(x) and x > 0][:6]
        out[d] = v / np.median(ref) if len(ref) >= 3 else np.nan
    return pd.Series(out)


def save(fig, path: Path):
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plots(key: str) -> list[Path]:
    cfg = DATASETS[key]
    base = HERE / "output" / key
    load, out = base / "load", base / "plots"
    out.mkdir(exist_ok=True)
    gt = json.loads((base / "ground_truth.json").read_text(encoding="utf8"))
    daily = pd.read_csv(base / "ground_truth_daily.csv", parse_dates=["day"])
    daily["day"] = daily["day"].dt.date
    daily = daily.set_index("day")
    sd = jl(load, "sales_days")
    sd["day"] = pd.to_datetime(sd["day"]).dt.date
    sd = sd.set_index("day")
    ch = jl(load, "sales_channel_splits")
    ch = ch[ch["hour"].isna()]
    ch["day"] = pd.to_datetime(ch["day"]).dt.date
    orders_ch = ch.pivot_table(index="day", columns="channel", values="orders", aggfunc="sum").fillna(0)
    sh = jl(load, "sales_hours")
    cal = jl(load, "local_calendar")
    cal["day"] = pd.to_datetime(cal["day"]).dt.date
    cal["end_day"] = pd.to_datetime(cal["end_day"]).dt.date
    name = cfg["name"].replace(" (demo)", "")
    files = []

    def spans(kinds_or_names, field="name"):
        rows = cal[cal[field].str.contains(kinds_or_names, regex=True)]
        return [(r.day, r.end_day if isinstance(r.end_day, dt.date) else r.day) for r in rows.itertuples()]

    ramadan = spans("^Ramadan$")
    school = [(r.day, r.end_day) for r in cal[cal["type"] == "school_holiday"].itertuples()]
    closures = [(dt.date.fromisoformat(c["start"]), dt.date.fromisoformat(c["end"])) for c in cfg["closures"]]
    camps = [(dt.date.fromisoformat(d["valid_from"]), dt.date.fromisoformat(d["valid_until"])) for d in gt["deals"]]

    # 1. Sales over time with what was going on.
    fig, ax = plt.subplots(figsize=(12, 4.6))
    g = sd["gross_sales"]
    idx = pd.to_datetime(pd.Index(g.index))
    for a, b in school:
        ax.axvspan(pd.Timestamp(a), pd.Timestamp(b) + pd.Timedelta(days=1), color=BAND, lw=0)
    for a, b in ramadan:
        ax.axvspan(pd.Timestamp(a), pd.Timestamp(b) + pd.Timedelta(days=1), color=AQUA, alpha=0.18, lw=0)
    for a, b in closures:
        ax.axvspan(pd.Timestamp(a), pd.Timestamp(b) + pd.Timedelta(days=1), color=MUTED, alpha=0.35, lw=0)
    ax.plot(idx, g.values, color=MUTED, lw=0.7, label="Daily sales")
    ax.plot(idx, g.rolling(28, min_periods=14).mean().values, color=BLUE, lw=2, label="28-day average")
    for a, b in camps:
        ax.plot([pd.Timestamp(a), pd.Timestamp(b)], [0, 0], color=ORANGE, lw=5, solid_capstyle="butt")
    ax.set_ylim(bottom=-g.max() * 0.03)
    ax.set_ylabel("£ a day (incl. VAT)")
    ax.set_title(f"{name}: daily sales, 24 months")
    handles = [plt.Line2D([], [], color=MUTED, lw=0.7, label="Daily sales"), plt.Line2D([], [], color=BLUE, lw=2, label="28-day average"),
               plt.Rectangle((0, 0), 1, 1, color=BAND, label="School holidays"), plt.Line2D([], [], color=ORANGE, lw=5, label="Email campaigns")]
    if ramadan and cfg["effects"].get("ramadan"):
        handles.append(plt.Rectangle((0, 0), 1, 1, color=AQUA, alpha=0.3, label="Ramadan"))
    if closures:
        handles.append(plt.Rectangle((0, 0), 1, 1, color=MUTED, alpha=0.5, label="Closed (refit)"))
    ax.legend(handles=handles, loc="upper left", ncol=6, fontsize=9)
    files.append(out / "01_sales_over_time.png"); save(fig, files[-1])

    # 2. Day of week and hour of day.
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 4.2), gridspec_kw={"width_ratios": [1, 1.6]})
    dow = pd.Series(sd["transactions"].values, index=[d.isoweekday() for d in sd.index]).groupby(level=0).mean()
    a1.bar(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], dow.values, color=BLUE, width=0.6)
    for i, v in enumerate(dow.values):
        a1.text(i, v, f"{v:.0f}", ha="center", va="bottom", fontsize=8, color=INK2)
    a1.set_title("Orders by day of week (average)")
    sh["day"] = pd.to_datetime(sh["day"]).dt.date
    in_ram = {d for a, b in ramadan for d in pd.date_range(a, b).date}
    cut = int(cfg["trading_day_cutoff"][:2])
    sh["order"] = sh["hour"].where(sh["hour"] >= cut, sh["hour"] + 24)
    if cfg["effects"].get("ramadan"):
        groups = [("Outside Ramadan", ~sh["day"].isin(in_ram), BLUE), ("Ramadan", sh["day"].isin(in_ram), AQUA)]
        title = "Share of the day's sales by hour"
    else:
        wk = sh["day"].map(lambda d: d.isoweekday() >= 6)
        groups = [("Monday to Friday", ~wk, BLUE), ("Weekend", wk, ORANGE)]
        title = "Share of the day's sales by hour"
    for lab, mask, col in groups:
        sub = sh[mask]
        tot = sub.groupby("day")["sales"].transform("sum")
        prof = (sub["sales"] / tot).groupby(sub["order"]).mean()
        a2.plot(prof.index, prof.values * 100, color=col, marker="o", ms=4, label=lab)
    if cfg["effects"].get("ramadan") and in_ram:
        pt = jl(load, "prayer_times")
        pt["day"] = pd.to_datetime(pt["day"]).dt.date
        mg = pd.to_datetime(pt[pt["day"].isin(in_ram)]["maghrib"]).dt.tz_convert("Europe/London")
        mh = (mg.dt.hour + mg.dt.minute / 60).mean()
        a2.axvline(mh, color=INK2, lw=1, ls="--")
        a2.text(mh + 0.1, a2.get_ylim()[1] * 0.92, f"average iftar {int(mh)}:{int((mh % 1) * 60):02d}", color=INK2, fontsize=8)
    a2.set_xticks(sorted(sh["order"].unique()))
    a2.set_xticklabels([f"{int(h) % 24:02d}" for h in sorted(sh["order"].unique())])
    a2.set_ylabel("% of the day's sales")
    a2.set_title(title)
    a2.legend()
    files.append(out / "02_week_and_hour.png"); save(fig, files[-1])

    # 3. Weather: orders against the same weekday's normal, by rain and by sunshine.
    event_days = set(daily.index[(daily["bank_holiday"] != 1) | (daily["eid"] != 1) | (daily["christmas_new_year"] != 1) | (daily["event_extra_orders"] != 0)]) \
        | {d for a, b in closures for d in pd.date_range(a, b).date} | {d for a, b in camps for d in pd.date_range(a, b).date}
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 4.2), sharey=True)
    bins = [-0.01, 0.2, 2, 5, 10, 100]
    labels = ["dry", "0.2-2", "2-5", "5-10", "10+"]
    rain = pd.cut(daily["rain_mm_open_hours"], bins, labels=labels)
    for chn, col, lab in (("delivery", BLUE, "Delivery"), ("dine_in", ORANGE, "Dine-in")):
        if chn not in orders_ch or orders_ch[chn].mean() < 10:
            continue
        r = vs_normal(orders_ch[chn], event_days)
        m = pd.DataFrame({"r": r, "bin": rain.reindex(r.index)}).groupby("bin", observed=False)["r"].mean()
        a1.plot(labels, m.reindex(labels).values, color=col, marker="o", ms=5, label=lab)
        k = cfg["effects"]["weather"]["rain"][chn]
        a1.text(len(labels) - 1, m.reindex(labels).values[-1], f"  truth: {k:+.3f} log per mm", color=INK2, fontsize=8, va="center")
    a1.axhline(1, color=INK2, lw=1)
    a1.set_xlabel("Rain during opening hours (mm)")
    a1.set_ylabel("Orders vs the same weekday's normal")
    a1.set_title("Rain")
    a1.legend()
    sun = pd.cut(daily["sun_vs_normal"], [-20, -4, -1.5, 1.5, 4, 20], labels=["much duller", "duller", "normal", "sunnier", "much sunnier"])
    for chn, col, lab in (("dine_in", ORANGE, "Dine-in"), ("takeaway", AQUA, "Takeaway")):
        if chn not in orders_ch or orders_ch[chn].mean() < 10:
            continue
        r = vs_normal(orders_ch[chn], event_days)
        m = pd.DataFrame({"r": r, "bin": sun.reindex(r.index)}).groupby("bin", observed=False)["r"].mean()
        a2.plot(list(m.index.astype(str)), m.values, color=col, marker="o", ms=5, label=f"{lab} (truth {cfg['effects']['weather']['sun'][chn]:+.3f} per hour)")
    a2.axhline(1, color=INK2, lw=1)
    a2.set_xlabel("Sunshine compared with the month's normal")
    a2.set_title("Sunshine")
    a2.legend(fontsize=8)
    files.append(out / "03_weather.png"); save(fig, files[-1])

    # 4. Calendar effects: what the data shows (bar) and the truth (dot).
    orders = sd["transactions"]
    # The "normal" days a comparison is made against leave out every kind of event.
    longer = in_ram | {d for a, b in school for d in pd.date_range(a, b).date} | set(daily.index[daily["payday"] != 1])
    r_all = vs_normal(orders, event_days | longer)
    rows = []
    e = cfg["effects"]

    def add(label, days, truth):
        vals = [r_all.get(d) for d in days if d in r_all.index]
        vals = [v for v in vals if v is not None and not pd.isna(v)]
        if len(vals) >= 2:
            rows.append((label, float(np.mean(vals)), truth, len(vals)))

    add("Bank holidays", list(daily.index[daily["bank_holiday"] != 1]), e["bank_holiday"])
    if e.get("ramadan"):
        add("Eid al-Fitr, first day", list(daily.index[daily["eid"] == e["eid_fitr"][0]]), e["eid_fitr"][0])
        add("Eid al-Adha, first day", list(daily.index[daily["eid"] == e["eid_adha"][0]]), e["eid_adha"][0])
        add("Ramadan days", [d for d in in_ram if d in daily.index and d not in event_days], e["ramadan"]["day_total"])
    add("School holiday days", [d for d in daily.index if daily.loc[d, "school_holiday"] != 1 and d not in event_days], e["school_holiday"])
    add("Payday weekends", [d for d in daily.index if daily.loc[d, "payday"] != 1 and d not in event_days], e["payday"])
    extras = pd.DataFrame(gt["event_extras"])
    if len(extras):
        extras["day"] = pd.to_datetime(extras["day"]).dt.date
        for kind, lab in (("football:", "Match days (TV)"), ("venue:", "Stadium and ExCeL events")):
            ds = sorted(set(extras[extras["name"].str.startswith(kind)]["day"]))
            if ds:
                r_ev = vs_normal(orders, (event_days | longer) - set(ds))
                v = [r_ev.get(d) for d in ds]
                v = [x for x in v if x is not None and not pd.isna(x)]
                if len(v) >= 2:
                    rows.append((lab, float(np.mean(v)), None, len(v)))
    fig, ax = plt.subplots(figsize=(10, 0.55 * len(rows) + 1.6))
    ys = np.arange(len(rows))
    ax.barh(ys, [r[1] - 1 for r in rows], left=1, color=BLUE, height=0.55, label="What the data shows")
    for y, (lab, v, t, n) in zip(ys, rows):
        if t is not None:
            ax.plot(t, y, "o", color=ORANGE, ms=8, mec=SURFACE, mew=2)
        ax.text(max(v, t or 0, 1) + 0.01, y, f"{(v - 1) * 100:+.0f}% ({n} days)", va="center", fontsize=8, color=INK2)
    ax.plot([], [], "o", color=ORANGE, ms=8, label="Truth (parameter)")
    ax.axvline(1, color=INK2, lw=1)
    ax.set_yticks(ys)
    ax.set_yticklabels([r[0] for r in rows])
    ax.invert_yaxis()
    ax.set_xlabel("Orders vs the same weekday's normal (1 = no effect)")
    ax.set_title(f"{name}: calendar effects")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.16), ncol=2, fontsize=8)
    files.append(out / "04_calendar_effects.png"); save(fig, files[-1])

    # 5. Price rises (and the new dish): units sold of the affected sections, weekly.
    items = jl(load, "sales_items")
    items["day"] = pd.to_datetime(items["day"])
    # Till names to dishes (the messy copy's renamed and misspelt names through its answer key).
    key_map = gt["messy"]["till_answer_key"] if gt.get("messy") else {}
    name_to_section = {d["name"]: d["section"] for d in gt["dishes"]}
    till_to_section = {d["till_name"]: d["section"] for d in gt["dishes"]}
    items["section"] = items["item"].map(lambda x: name_to_section.get(key_map.get(x), till_to_section.get(x)))
    fig, ax = plt.subplots(figsize=(12, 4.2))
    colors = [BLUE, ORANGE, AQUA]
    rises = cfg["price_rises"]
    secs = sorted({s for r in rises for s in r["sections"]})[:3]
    wk = items.groupby([pd.Grouper(key="day", freq="W-MON"), "section"])["quantity"].sum().unstack().fillna(0)
    tot = items.groupby(pd.Grouper(key="day", freq="W-MON"))["quantity"].sum()
    for s, col in zip(secs, colors):
        if s in wk:
            share = (wk[s] / tot * 100).rolling(3, min_periods=1).mean()
            ax.plot(share.index, share.values, color=col, label=f"{s}: share of all items (%)")
    for r in rises:
        d = pd.Timestamp(r["day"])
        ax.axvline(d, color=INK2, lw=1, ls="--")
        ax.text(d, ax.get_ylim()[1] * 0.97, f" +{round(r['pct'] * 100)}% prices", fontsize=8, color=INK2, va="top")
    for c in closures:
        ax.axvspan(pd.Timestamp(c[0]), pd.Timestamp(c[1]), color=MUTED, alpha=0.3, lw=0)
    ax.set_title(f"Price rises: dish choice (elasticity {cfg['elasticity']}) and visits (order elasticity {cfg['order_elasticity']})")
    ax.set_ylabel("% of items sold")
    ax.legend(loc="lower left", fontsize=8)
    files.append(out / "05_price_rises.png"); save(fig, files[-1])

    if cfg["new_dishes"]:
        nd = cfg["new_dishes"][0]
        new_till = next(d["till_name"] for d in gt["dishes"] if d["name"] == nd["name"])
        sib_till = next(d["till_name"] for d in gt["dishes"] if d["name"] == nd["cannibalises"])
        items["dish"] = items["item"].map(lambda x: key_map.get(x, x))
        fig, ax = plt.subplots(figsize=(12, 4))
        for till, nm, col in ((new_till, nd["name"], BLUE), (sib_till, nd["cannibalises"], ORANGE)):
            names = {k for k, v in key_map.items() if v == nm} | {till}
            w = items[items["item"].isin(names)].groupby(pd.Grouper(key="day", freq="W-MON"))["quantity"].sum()
            ax.plot(w.index, w.values, color=col, label=nm)
        ax.axvline(pd.Timestamp(nd["launch"]), color=INK2, lw=1, ls="--")
        ax.text(pd.Timestamp(nd["launch"]), ax.get_ylim()[1] * 0.97, f" {nd['name']} launched (builds up over {nd['ramp_days']} days, takes {round(nd['share'] * 100)}% of {nd['cannibalises']})", fontsize=8, color=INK2, va="top")
        ax.set_ylabel("Portions a week")
        ax.set_title("New dish launch and the dish it takes orders from")
        ax.legend(loc="upper left")
        files.append(out / "06_new_dish.png"); save(fig, files[-1])

    # 7. Deals: the true effect of each campaign.
    deals = sorted(gt["deals"], key=lambda d: d["valid_from"])
    fig, ax = plt.subplots(figsize=(10, 0.5 * len(deals) + 1.4))
    vals = [d["net_uplift_pence"] / 100 for d in deals]
    ys = np.arange(len(deals))
    ax.barh(ys, vals, color=[BLUE if v >= 0 else ORANGE for v in vals], height=0.55)
    for y, d, v in zip(ys, deals, vals):
        ax.text(max(v, 0), y, f"  £{v:,.0f}  ({d['incremental_orders']} extra orders, uplift {round(d['true_uplift_on_orders'] * 100)}%)", va="center",
                ha="left", fontsize=8, color=INK2)
    ax.set_yticks(ys)
    ax.set_yticklabels([f"{d['name']} ({d['valid_from'][:7]})" for d in deals])
    ax.invert_yaxis()
    ax.axvline(0, color=INK2, lw=1)
    ax.set_xlabel("True net uplift (£): sales with the deal minus without, after discounts")
    ax.set_title(f"{name}: what each deal really did")
    lo, hi = min(vals + [0]), max(vals)
    ax.set_xlim(min(lo * 1.5, -hi * 0.05), hi * 1.9)
    files.append(out / "07_deals.png"); save(fig, files[-1])

    # 8. Costs: labour and food purchases as % of net sales, every 4 weeks.
    net = (sd["gross_sales"] / 1.2)
    net.index = pd.to_datetime(pd.Index(net.index))
    lab = pd.Series(gt["labour_cost_pence_per_week"]) / 100
    lab.index = pd.to_datetime(lab.index)
    inv = jl(load, "invoices")
    inv["invoice_date"] = pd.to_datetime(inv["invoice_date"])
    origin = pd.Timestamp(gt["window"]["start"])
    origin -= pd.Timedelta(days=origin.dayofweek)  # a Monday, like the labour weeks
    food = inv.groupby(pd.Grouper(key="invoice_date", freq="28D", origin=origin))["net_pence"].sum() / 100
    n28 = net.groupby(pd.Grouper(freq="28D", origin=origin)).sum()
    l28 = lab.groupby(pd.Grouper(freq="28D", origin=origin)).sum()
    last_full = pd.Timestamp(gt["window"]["end"]) - pd.Timedelta(days=27)  # leave out a part-period at the end
    food, l28 = food[food.index <= last_full], l28[l28.index <= last_full]
    fig, ax = plt.subplots(figsize=(12, 4))
    ax.plot(l28.index, (l28 / n28.reindex(l28.index) * 100).values, color=BLUE, marker="o", ms=4, label="Labour % of net sales")
    ax.plot(food.index, (food / n28.reindex(food.index) * 100).values, color=ORANGE, marker="o", ms=4, label="Food purchases % of net sales")
    tg = {t["metric"]: t["value"] for t in json.loads(json.dumps([json.loads(x) for x in next(load.glob("*_targets.jsonl")).read_text().splitlines()]))}
    for m, col in (("labour_pct", BLUE), ("food_cost_pct", ORANGE)):
        if m in tg:
            ax.axhline(tg[m], color=col, lw=1, ls=":")
            ax.text(ax.get_xlim()[0], tg[m], f" target {tg[m]:.0f}%", color=INK2, fontsize=8, va="bottom")
    ax.set_ylim(0, 50)
    ax.set_ylabel("%")
    ax.set_title("Labour and food cost, every 4 weeks")
    ax.legend(loc="upper right")
    files.append(out / "08_costs.png"); save(fig, files[-1])

    if gt.get("messy"):
        ms = gt["messy"]
        fig, ax = plt.subplots(figsize=(12, 3.6))
        allg = daily["gross_pence"] / 100
        ax.plot(pd.to_datetime(pd.Index(allg.index)), allg.values, color=MUTED, lw=0.7, label="What really happened (ground truth)")
        rec = sd["gross_sales"]
        ax.plot(pd.to_datetime(pd.Index(rec.index)), rec.values, ".", color=BLUE, ms=3, label="What was recorded")
        miss = [pd.Timestamp(d) for d in ms["missing_days"]]
        ax.plot(miss, [allg.get(dt.date.fromisoformat(str(d.date())), 0) for d in miss], "x", color=ORANGE, ms=6, mew=2, label=f"Missing days ({len(miss)})")
        u = cfg["unexplained"][0]
        ax.axvspan(pd.Timestamp(u["start"]), pd.Timestamp(u["end"]) + pd.Timedelta(days=1), color=AQUA, alpha=0.25, lw=0, label="Unexplained bad week (not in any table)")
        ax.set_ylabel("£ a day")
        ax.set_title(f"Messy copy: {len(ms['missing_days'])} days missing, {len(ms['duplicate_item_lines'])} duplicate item lines, "
                     f"{len(ms['typos'])} typos, {len(ms['unmatched_till_names'])} till names to match")
        ax.legend(loc="upper left", ncol=2, fontsize=8)
        files.append(out / "09_mess.png"); save(fig, files[-1])
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="all")
    a = ap.parse_args()
    for k in (list(DATASETS) if a.dataset == "all" else [a.dataset]):
        fs = plots(k)
        print(k, len(fs), "charts ->", fs[0].parent)


if __name__ == "__main__":
    main()
