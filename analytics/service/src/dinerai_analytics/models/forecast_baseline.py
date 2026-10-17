"""The baseline forecast: same weekday, average of the last 4 weeks. A BENCHMARK.

It is the yardstick the real forecast model must beat, never a forecast an owner
sees (role 'benchmark': the app and the database both hide it, whatever its
back-test says).

For each day from the issue day to 13 days after it, and for each series:
  likely = the average of the same weekday in the last 4 weeks that had ended by
           the issue time (closed or missing days are left out)
  low    = the lowest of those weeks, high = the highest
  at least 2 usable weeks, or no forecast for that day.

Series (metric, channel):
  orders  all (transactions), and per channel where sales_channel_splits has data
  covers  all, and per channel where the splits record covers (usually dine-in)
  sales   all only (net, in pence). Channel splits include VAT while daily sales
          are net, so channel sales aren't forecast: they wouldn't be the same measure.

Back-tested over the last 12 weeks with backtest.rolling_backtest, the same
replay every forecast model uses; orders/all is the headline score.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from ..backtest import MIN_SCORED_DAYS, rolling_backtest, truncate
from ..cutoff import forecast_days
from ..registry import ModelResult, ModelSpec, PermanentError, RunContext

WEEKS = 4
MIN_WEEKS = 2
# How far back the run reads: the 12-week back-test, its 13-day lead-in, and 4 weeks before that, with room to spare.
HISTORY_DAYS = 12 * 7 + 13 + WEEKS * 7 + 21
# Data older than this at the issue time means something is wrong upstream: fail, don't forecast from it.
STALE_AFTER_DAYS = 14

METRIC_ORDER = ("orders", "covers", "sales_pence")
CHANNEL_ORDER = ("all", "dine_in", "takeaway", "delivery")

Key = tuple[str, str]  # (metric, channel)


def predict(series: dict[dt.date, float], target: dt.date, known_through: dt.date) -> tuple[float, float, float] | None:
    """Same weekday in the last 4 weeks known by the issue time; low/likely/high = min/mean/max."""
    # The latest same-weekday day not after known_through, then the 3 weeks before it.
    back = (target - known_through).days
    first = target - dt.timedelta(days=7 * max(1, -(-back // 7)))
    values = [series[d] for d in (first - dt.timedelta(days=7 * k) for k in range(WEEKS)) if d in series]
    if len(values) < MIN_WEEKS:
        return None
    likely = sum(values) / len(values)
    return (min(values), likely, max(values))


def build_series(daily: list[dict], channels: list[dict]) -> dict[Key, dict[dt.date, float]]:
    """Actuals per (metric, channel). Days with no trade (closed) are left out."""
    series: dict[Key, dict[dt.date, float]] = defaultdict(dict)
    open_days: set[dt.date] = set()
    for r in daily:
        orders, net = r["transactions"], r["net_pence"]
        if not orders and not net:
            continue  # closed
        open_days.add(r["day"])
        if orders is not None:
            series[("orders", "all")][r["day"]] = float(orders)
        if net is not None:
            series[("sales_pence", "all")][r["day"]] = float(net)
        if r["covers"] is not None:
            series[("covers", "all")][r["day"]] = float(r["covers"])

    # Channels: a day with any split rows counts; a channel missing that day had no orders.
    by_day: dict[dt.date, dict[str, dict]] = defaultdict(dict)
    for r in channels:
        if r["day"] in open_days:
            by_day[r["day"]][r["channel"]] = r
    seen = {c for rows in by_day.values() for c in rows}
    for day, rows in by_day.items():
        for channel in seen:
            row = rows.get(channel)
            if row is None:
                series[("orders", channel)][day] = 0.0
                continue
            if row["orders"] is not None:
                series[("orders", channel)][day] = float(row["orders"])
            if row["covers"] is not None:
                series[("covers", channel)][day] = float(row["covers"])
    return {k: v for k, v in series.items() if v}


def ordered(keys) -> list[Key]:
    return sorted(keys, key=lambda k: (METRIC_ORDER.index(k[0]), CHANNEL_ORDER.index(k[1])))


def run(ctx: RunContext) -> ModelResult:
    since = ctx.known_through - dt.timedelta(days=HISTORY_DAYS)
    daily = ctx.reader.rows(
        "sales_daily", ["day", "net_pence", "transactions", "covers"],
        where=[("day", ">=", since), ("day", "<=", ctx.known_through)], order_by=["day"],
    )
    channels = ctx.reader.rows(
        "sales_channels", ["day", "channel", "orders", "covers"],
        where=[("day", ">=", since), ("day", "<=", ctx.known_through)], null=["hour"], order_by=["day", "channel"],
    )
    series = build_series(daily, channels)
    if ("orders", "all") not in series:
        raise PermanentError(f"No sales with orders between {since} and {ctx.known_through}")
    latest = max(series[("orders", "all")])
    if (ctx.known_through - latest).days > STALE_AFTER_DAYS:
        raise PermanentError(f"The latest sales day is {latest}, more than {STALE_AFTER_DAYS} days before {ctx.known_through}")

    # The forecasts: the issue day and the 13 days after it.
    targets = forecast_days(ctx.issue_day)
    rows, skipped = [], []
    for key in ordered(series):
        metric, channel = key
        for target in targets:
            p = predict(series[key], target, ctx.known_through)
            if p is None:
                skipped.append(f"{metric}/{channel} {target}")
                continue
            low, likely, high = (round(x, 2) for x in p)
            rows.append({"target_day": target, "metric": metric, "channel": channel, "low": low, "likely": likely, "high": high})

    # The 12-week back-test, replaying the same rule night by night.
    def predict_origin(origin: dt.date, issued: dt.datetime, kt: dt.date):
        out = {}
        for key, s in series.items():
            known = truncate(s, kt)
            out[key] = {t: p for t in forecast_days(origin) if (p := predict(known, t, kt)) is not None}
        return out

    bt = rolling_backtest(series, predict_origin, ctx.issue_day, ctx.trading_day_cutoff_hour)
    scored = [{"metric": m, "channel": c, **bt["series"][(m, c)]} for m, c in ordered(series)]
    primary = next(s for s in scored if (s["metric"], s["channel"]) == ("orders", "all"))
    passed = primary["days"] >= MIN_SCORED_DAYS and primary["wape"] is not None

    metrics = {
        "role_note": "benchmark: the yardstick for the real forecast; never shown to an owner",
        "primary": {k: primary[k] for k in ("metric", "channel", "wape", "coverage", "bias", "n", "days")},
        "series": scored,
        "backtest": bt["window"],
        "forecast": {
            "issue_day": ctx.issue_day.isoformat(),
            "known_through": ctx.known_through.isoformat(),
            "rows": len(rows),
            "skipped": skipped[:50],
            "skipped_count": len(skipped),
        },
        "method": {"weeks": WEEKS, "min_weeks": MIN_WEEKS, "low": "min", "likely": "mean", "high": "max"},
    }
    return ModelResult(outputs={"forecasts": rows}, metrics=metrics, score=primary["wape"], passed=passed)


SPEC = ModelSpec(
    name="forecast_baseline",
    version="1.0.0",
    kind="forecast",
    role="benchmark",
    job_type="forecast_baseline",
    views=("sales_daily", "sales_channels"),
    run=run,
    time_budget_s=120,
    history_days=HISTORY_DAYS,
    backtest_metric="WAPE",
    params={"weeks": WEEKS, "min_weeks": MIN_WEEKS, "horizon_days": 14, "backtest_weeks": 12},
)
