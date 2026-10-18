"""The synthetic recovery test: forecast_daily's estimated effects against the generator's known ones.

  .venv\\Scripts\\python scripts\\recovery_report.py --report report.json --truth C:\\Users\\miraa\\dev\\naila-synth\\analytics\\generator\\output
                                                   [--out recovery.json]

--report is the file `forecast-report` wrote (it holds each restaurant's weights from today's fit); --truth is the
generator's output folder (each dataset's ground_truth.json and ground_truth_daily.csv).

This script lives outside the model package on purpose: the model never reads the generator's answers (a test
checks that), and nothing here feeds back into it. It only reports.

Each row: the true effect, the estimate, its 95% interval, and whether the estimate is within tolerance (3
percentage points, or 25% of the true effect, whichever is larger). Effects are % changes in the day's orders (all
channels together unless a channel is named): the channels' weights are combined with their shares of orders.
Where our factor and the generator's mean different things (rain counted in lunch and dinner windows here, over
all open hours there; temperature against the seasonal normal here, against 15 C there; hour-level effects like
Jummah, the iftar surge or the school-holiday lunch), the row says "not comparable" or names the difference.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

DATASETS = {"demo-saffron-lane": "halal_ilford", "demo-fern-and-fold": "cafe_walthamstow", "demo-broadway-late-grill": "takeaway_stratford",
            "demo-saffron-lane-messy": "halal_ilford_messy"}
CHANNELS = ("dine_in", "takeaway", "delivery")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
RNG = np.random.default_rng(0)
DRAWS = 4000


def pct(log_effect: float) -> float:
    return (math.exp(log_effect) - 1) * 100


def within(est: float, true: float) -> bool:
    return abs(est - true) <= max(3.0, 0.25 * abs(true))


class Weights:
    def __init__(self, w: dict):
        self.ch = w["channels"]
        self.shares = w["shares"]
        self.offset = w.get("weekday_offset", {})
        self.days = w.get("factor_days", {})

    def channel(self, c: str, factor: str):
        e = self.ch.get(c, {}).get(factor)
        return (e[0], e[1], bool(e[4])) if e else None

    def combined(self, factors: dict[str, float], extra_by_channel: dict[str, float] | None = None):
        """The all-channel effect of setting factors (name -> value), as (estimate %, low %, high %, moved by data).
        Draws each channel's weights independently from Normal(estimate, sd)."""
        chans = [c for c in CHANNELS if c in self.ch]
        if not chans:
            return None
        total = sum(self.shares.get(c, 0) for c in chans) or 1.0
        sims = np.zeros(DRAWS)
        point = 0.0
        moved = False
        for c in chans:
            s = self.shares.get(c, 0) / total
            mean = sum(self.ch[c][f][0] * v for f, v in factors.items() if f in self.ch[c])
            var = sum((self.ch[c][f][1] * v) ** 2 for f, v in factors.items() if f in self.ch[c])
            moved = moved or any(self.ch[c][f][4] for f in factors if f in self.ch[c])
            extra = (extra_by_channel or {}).get(c, 0.0)
            point += s * math.exp(mean + extra)
            sims += s * np.exp(RNG.normal(mean, math.sqrt(var), DRAWS) + extra)
        base = sum(self.shares.get(c, 0) / total * math.exp((extra_by_channel or {}).get(c, 0.0)) for c in chans)
        lo, hi = np.percentile(sims / base, [2.5, 97.5])
        return (point / base - 1) * 100, (lo - 1) * 100, (hi - 1) * 100, moved


def row(name: str, true: float | None, est, note: str = "", comparable: bool = True) -> dict:
    out = {"effect": name, "true_pct": None if true is None else round(true, 2), "note": note}
    if est is None:
        return {**out, "estimate_pct": None, "interval": None, "within": None, "comparable": comparable, "moved_by_data": None}
    e, lo, hi, moved = est
    return {**out, "estimate_pct": round(e, 2), "interval": [round(lo, 2), round(hi, 2)],
            "within": within(e, true) if (comparable and true is not None) else None, "comparable": comparable, "moved_by_data": moved}


def read_daily(path: Path) -> dict[str, dict]:
    with path.open(encoding="utf8") as f:
        return {r["day"]: r for r in csv.DictReader(f)}


def mean_col(daily: dict, days, col: str) -> float | None:
    vals = [float(daily[d][col]) for d in days if d in daily and daily[d].get(col) not in (None, "") and not daily[d].get("closed")]
    return (sum(vals) / len(vals) - 1) * 100 if vals else None


def recover(slug: str, weights: dict, truth_dir: Path) -> list[dict]:
    key = DATASETS[slug]
    g = json.loads((truth_dir / key / "ground_truth.json").read_text(encoding="utf8"))
    daily = read_daily(truth_dir / key / "ground_truth_daily.csv")
    p = g["parameters"]
    eff, demand = p["effects"], p["demand"]
    w = Weights(weights)
    rows = []
    on = lambda f: sorted(w.days.get(f, {}))  # noqa: E731

    # Weekday against the average day, as effects on orders: each channel's centred weekday weight (its sd from the
    # full covariance) plus the hours-open offset (also centred), the channels combined by share.
    true_dow = [math.log(x) for x in demand["dow"]]
    tm = sum(true_dow) / 7
    centred = weights.get("weekday_centred", {})
    off_mean = sum(w.offset.get(d, 0.0) for d in WEEKDAYS) / 7
    chans = [c for c in CHANNELS if c in centred]
    total = sum(w.shares.get(c, 0) for c in chans) or 1.0
    logs, sims = [], []
    for d in WEEKDAYS:
        off = w.offset.get(d, 0.0) - off_mean
        point = sum(w.shares.get(c, 0) / total * math.exp(centred[c][d][0] + off) for c in chans)
        sim = sum(w.shares.get(c, 0) / total * np.exp(RNG.normal(centred[c][d][0], centred[c][d][1], DRAWS) + off) for c in chans)
        logs.append(math.log(point))
        sims.append(np.log(sim))
    centre = sum(logs) / 7
    for k, d in enumerate(WEEKDAYS):
        lo, hi = np.percentile(sims[k] - centre, [2.5, 97.5])
        rows.append(row(f"weekday {d} (vs the average day)", pct(true_dow[k] - tm), (pct(logs[k] - centre), pct(lo), pct(hi), True)))

    # Season: the first yearly wave's size and peak.
    amp, peak = demand["season_amplitude"] * 100, demand["season_peak_doy"]
    cos1 = sum(w.shares.get(c, 0) * w.ch[c]["season_cos1"][0] for c in CHANNELS if c in w.ch) / max(sum(w.shares.values()), 1e-9)
    sin1 = sum(w.shares.get(c, 0) * w.ch[c]["season_sin1"][0] for c in CHANNELS if c in w.ch) / max(sum(w.shares.values()), 1e-9)
    est_amp = pct(math.hypot(cos1, sin1))
    est_peak = round((math.degrees(math.atan2(sin1, cos1)) % 360) / 360 * 365.25)
    rows.append({**row("season: size of the yearly wave", amp, (est_amp, est_amp, est_amp, True), f"peak: true day {peak}, estimated day {est_peak}"),
                 "interval": None})

    rows.append(row("trend per year", demand["trend_per_year"] * 100, w.combined({"trend": 1.0}),
                    "price rises also move orders; ours is a local trend (recent days weigh more)"))
    rows.append(row("price: orders after a 10% menu price rise", (1.1 ** p["order_elasticity"] - 1) * 100,
                    w.combined({"log_price_index": math.log(1.1)})))

    # Calendar effects on the days our factors were on, from the generator's daily multipliers.
    for f, col, note in (("bank_holiday", "bank_holiday", ""), ("xmas_eve", "christmas_new_year", ""), ("nye", "christmas_new_year", ""),
                         ("new_year", "christmas_new_year", ""), ("xmas_week", "christmas_new_year", ""),
                         ("payday_window", "payday", "true: payday to the Sunday after; ours: payday and the 2 days after"),
                         ("school_holiday", "school_holiday", "daily part only; the generator also lifts weekday lunches in some datasets"),
                         ("ramadan_1_10", "ramadan", "daily total; the hour shape (iftar surge) is in the hour profile"),
                         ("ramadan_11_20", "ramadan", ""), ("ramadan_last10", "ramadan", ""),
                         ("eid_fitr_d1", "eid", ""), ("eid_fitr_d2", "eid", ""), ("eid_fitr_d3", "eid", ""),
                         ("eid_adha_d1", "eid", ""), ("eid_adha_d2", "eid", ""), ("eid_adha_d3", "eid", ""),
                         ("chand_raat", "chand_raat", "daily part; the generator adds x1.4 after 20:00")):
        days = on(f)
        true = mean_col(daily, days, col)
        if true is None:
            rows.append(row(f, None, w.combined({f: 1.0}), "no such day in the history", comparable=False))
            continue
        rows.append(row(f, true, w.combined({f: 1.0}), note))
    for f in ("bh_eve", "bh_after", "mothers_day", "valentines", "clock_change_fwd", "clock_change_back", "diwali", "inset_day"):
        if on(f):
            rows.append(row(f, 0.0, w.combined({f: 1.0}), "no such effect in the generator"))

    # Sport matches and crowds: the generator's extra orders on those days, as a share of the day's expected orders.
    extras = defaultdict(lambda: {"football": 0.0, "venue": 0.0})
    for e in g.get("event_extras", []):
        kind = "football" if str(e["name"]).startswith("football") else "venue"
        extras[e["day"]][kind] += float(e["extra_orders"])
    fd, fa = w.days.get("football_during", {}), w.days.get("football_after", {})
    match_days = sorted(set(fd) | set(fa))
    if match_days:
        true_l, est_l = [], []
        for d in match_days:
            exp_orders = float(daily[d]["expected_orders_no_deals"]) if d in daily else None
            if not exp_orders:
                continue
            true_l.append(extras[d]["football"] / exp_orders * 100)
            est_l.append({"football_during": fd.get(d, 0.0), "football_after": fa.get(d, 0.0)})
        if true_l:
            ests = [w.combined(x) for x in est_l]
            avg = tuple(sum(e[i] for e in ests) / len(ests) for i in range(3))
            rows.append(row("relevant match days (average effect)", sum(true_l) / len(true_l), (*avg, any(e[3] for e in ests)),
                            f"{len(true_l)} days; the generator puts the effect in the hours around kick-off"))
    vd = w.days.get("venue", {})
    if vd:
        xs, ys = [], []
        for d, v in vd.items():
            exp_orders = float(daily[d]["expected_orders_no_deals"]) if d in daily else None
            if exp_orders:
                xs.append(v)
                ys.append(math.log(1 + extras[d]["venue"] / exp_orders))
        if xs and sum(x * x for x in xs) > 0:
            per_unit = sum(x * y for x, y in zip(xs, ys, strict=True)) / sum(x * x for x in xs)
            rows.append(row("venue crowds: per 10,000 people at 0 km", pct(per_unit), w.combined({"venue": 1.0}),
                            f"true value fitted from the generator's extra orders on {len(xs)} event days"))

    # Deals: the true average lift over each deal's valid days.
    for deal in g.get("deals", []):
        cid = deal["campaign_id"]
        f = f"deal:{cid}"
        if not any(f in w.ch.get(c, {}) for c in CHANNELS):
            continue
        valid = [d for d in _span(deal["offer"]["valid_from"], deal["offer"]["valid_to"]) if d in daily]
        exp_total = sum(float(daily[d]["expected_orders_no_deals"]) for d in valid)
        inc = sum(float(d["incremental_orders"]) for d in deal.get("per_day", []))
        if exp_total:
            rows.append(row(f"deal: {deal['name']}", inc / exp_total * 100, w.combined({f: 1.0}),
                            f"true: its extra orders over all {len(valid)} valid days (it only lifted {len(deal.get('per_day', []))} target days and hours)"))

    # Weather, per channel.
    weather = eff.get("weather", {})
    for c in CHANNELS:
        if c not in w.ch:
            continue
        sun = weather.get("sun", {}).get(c)
        if sun is not None:
            e = w.channel(c, "sunshine")
            rows.append(row(f"{c}: sunshine, per hour above the month's normal", pct(sun), _ci(e)))
        rain = weather.get("rain", {}).get(c)
        if rain is not None:
            e = w.channel(c, "rain_dinner")
            rows.append(row(f"{c}: rain, per mm", pct(rain), _ci(e),
                            "not comparable: ours is rain in the 17:00 to 22:00 open hours, the generator's over all open hours", comparable=False))
        hot = weather.get("temp_hot", {}).get(c)
        if hot:
            e = w.channel(c, "temp_hot")
            rows.append(row(f"{c}: heat, per degree above {weather.get('temp_hot_above')} C", pct(hot), _ci(e),
                            "not comparable: ours is the day's maximum above 26 C, the generator's the open hours' temperature", comparable=False))
    return rows


def _ci(e: tuple) -> tuple:
    """(estimate %, low %, high %, moved) from one channel's (estimate, sd, moved) on the log scale."""
    return pct(e[0]), pct(e[0] - 1.96 * e[1]), pct(e[0] + 1.96 * e[1]), e[2]


def _span(a: str, b: str):
    import datetime as dt

    d, end = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    while d <= end:
        yield d.isoformat()
        d += dt.timedelta(days=1)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", required=True)
    ap.add_argument("--truth", required=True)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    report = json.loads(Path(a.report).read_text(encoding="utf8"))
    out = {}
    sys.stdout.reconfigure(encoding="utf-8")
    for slug, entry in report.items():
        if slug not in DATASETS or "weights_now" not in entry:
            continue
        rows = recover(slug, entry["weights_now"], Path(a.truth))
        out[slug] = rows
        comparable = [r for r in rows if r["within"] is not None]
        print(f"\n{slug}: {sum(r['within'] for r in comparable)} of {len(comparable)} comparable effects within tolerance")
        for r in rows:
            mark = "  -  " if r["within"] is None else (" ok  " if r["within"] else " OUT ")
            iv = f"[{r['interval'][0]:+.1f}, {r['interval'][1]:+.1f}]" if r.get("interval") else ""
            est = f"{r['estimate_pct']:+.1f}" if r.get("estimate_pct") is not None else "n/a"
            true = f"{r['true_pct']:+.1f}" if r.get("true_pct") is not None else "n/a"
            print(f" {mark} {r['effect']:<52} true {true:>7}  est {est:>7} {iv:<18} {r['note']}")
    if a.out:
        Path(a.out).write_text(json.dumps(out, indent=1), encoding="utf8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
