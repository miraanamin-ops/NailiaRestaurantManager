"""Generate the synthetic datasets.

  py generate.py                         all four, 24 months ending yesterday, seed 42
  py generate.py --dataset cafe_walthamstow --seed 7 --end 2026-10-16
  py generate.py --no-inputs             skip the messy input files (faster)

Writes output/<dataset>/ (load files, ground truth, inputs) and fixtures/<dataset>/
(the 3-week slice committed for CI). Needs cache/ filled by fetch_outside.py.
"""

from __future__ import annotations

import argparse
import datetime as dt
import time
from pathlib import Path

from synth import mess, rows, truth
from synth.costs import Costs
from synth.datasets import DATASETS
from synth.simulate import run
from synth.staff import Staffing
from synth.write import FIXTURE_WINDOW, fixture_slice, write_json, write_rows

HERE = Path(__file__).resolve().parent


def generate(key: str, seed: int, end: dt.date, inputs: bool = True, out_root: Path = HERE / "output", fixtures_root: Path | None = HERE / "fixtures") -> dict:
    cfg = DATASETS[key]
    t0 = time.time()
    sim = run(cfg, seed, end)
    staffing = Staffing(sim, seed)
    costs = Costs(sim, seed)
    T = rows.build(sim, staffing, costs)
    mess_log = mess.apply(T, cfg, sim.menu, seed) if cfg.get("messy") else None
    gt, daily = truth.build(sim, staffing, costs, mess_log)
    out = out_root / key
    counts = write_rows(T, out / "load")
    if inputs:
        from synth import inputs as inp
        gt["inputs"] = inp.write_all(sim, staffing, costs, T, out / "inputs", seed)
    write_json(gt, out / "ground_truth.json")
    (out / "ground_truth_daily.csv").write_text(daily, encoding="utf8", newline="\n")
    if fixtures_root is not None and FIXTURE_WINDOW[1] <= end.isoformat():
        S = fixture_slice(T)
        write_rows(S, fixtures_root / key / "load")
    print(f"{key}: {sum(counts.values()):,} rows in {time.time() - t0:.0f}s -> {out}")
    return counts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="all", help="all, or one of: " + ", ".join(DATASETS))
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--end", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--no-inputs", action="store_true")
    a = ap.parse_args()
    keys = list(DATASETS) if a.dataset == "all" else [a.dataset]
    for k in keys:
        generate(k, a.seed, dt.date.fromisoformat(a.end), inputs=not a.no_inputs)


if __name__ == "__main__":
    main()
