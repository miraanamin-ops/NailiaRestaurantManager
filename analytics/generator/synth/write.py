"""Writes a dataset: load/NN_<table>.jsonl (insert order), ground truth, and the 3-week fixture slice."""

from __future__ import annotations

import datetime as dt
import json
import shutil
from pathlib import Path

from .rows import TABLE_ORDER

# The fixture window: three weeks in Ramadan 2026, ending the weekend after Eid al-Fitr.
FIXTURE_WINDOW = ("2026-03-02", "2026-03-22")


def write_rows(T: dict, folder: Path) -> dict[str, int]:
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    counts = {}
    for i, t in enumerate(TABLE_ORDER):
        rows = T.get(t, [])
        counts[t] = len(rows)
        with open(folder / f"{i:02d}_{t}.jsonl", "w", encoding="utf8", newline="\n") as fh:
            for r in rows:
                fh.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")
    return counts


def write_json(obj, path: Path):
    path.write_text(json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False), encoding="utf8", newline="\n")


def fixture_slice(T: dict, a: str = FIXTURE_WINDOW[0], b: str = FIXTURE_WINDOW[1]) -> dict:
    """The fixture: the same rows, cut to the window (and whatever they point at)."""
    A, B = a, b
    inside = lambda d: d is not None and A <= d[:10] <= B
    overlaps = lambda s, e: s is not None and s[:10] <= B and (e or s)[:10] >= A
    S = {t: list(rows) for t, rows in T.items()}
    for t in ("sales_days", "sales_hours", "sales_items", "sales_channel_splits", "weather_days", "prayer_times"):
        S[t] = [r for r in S[t] if inside(r["day"])]
    S["weather_hours"] = [r for r in S["weather_hours"] if inside(r["hour_start"])]
    S["weather_forecasts"] = [r for r in S["weather_forecasts"] if inside(r.get("hour_start") or r.get("target_day"))]
    wk_from = (dt.date.fromisoformat(A) - dt.timedelta(days=6)).isoformat()
    S["rota_weeks"] = [r for r in S["rota_weeks"] if wk_from <= r["week_start"] <= B]
    weeks = {r["id"] for r in S["rota_weeks"]}
    S["rota_shifts"] = [r for r in S["rota_shifts"] if r["rota_week_id"] in weeks and inside(r["business_date"])]
    shifts = {r["id"] for r in S["rota_shifts"]}
    S["shift_actuals"] = [r for r in S["shift_actuals"] if inside(r["business_date"]) and (r["rota_shift_id"] is None or r["rota_shift_id"] in shifts)]
    S["staff_time_off"] = [r for r in S["staff_time_off"] if overlaps(r["starts_at"], r["ends_at"])]
    S["invoices"] = [r for r in S["invoices"] if inside(r["invoice_date"])]
    invs = {r["id"] for r in S["invoices"]}
    S["invoice_lines"] = [r for r in S["invoice_lines"] if r["invoice_id"] in invs]
    lines = {r["id"] for r in S["invoice_lines"]}
    S["ingredient_prices"] = [dict(r, invoice_line_id=r["invoice_line_id"] if r["invoice_line_id"] in lines else None)
                              for r in S["ingredient_prices"] if r["effective_from"] <= B]
    S["campaigns"] = [r for r in S["campaigns"] if overlaps(r["valid_from"], r["valid_until"])]
    camps = {r["id"] for r in S["campaigns"]}
    S["drafts"] = [r for r in S["drafts"] if any(c["draft_id"] == r["id"] for c in S["campaigns"])]
    S["restaurant_events"] = [r for r in S["restaurant_events"]
                              if ((r.get("campaign_id") in camps) if r.get("campaign_id") else overlaps(r["starts_at"], r["ends_at"]))]
    S["local_calendar"] = [r for r in S["local_calendar"] if overlaps(r["day"], r["end_day"])]
    evs = {r["id"] for r in S["local_calendar"]}
    S["football_fixtures"] = [r for r in S["football_fixtures"] if r["event_id"] in evs]
    S["calendar_relevance"] = [r for r in S["calendar_relevance"] if r["event_id"] in evs]
    return S
