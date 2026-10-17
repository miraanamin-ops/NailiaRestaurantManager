"""Shared fixtures: two datasets generated once per test run into a temporary folder
(the Ilford restaurant and its messy copy, no input files), with a fixed end date so
the results never depend on today's date."""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from generate import generate  # noqa: E402
from synth.rows import TABLE_ORDER  # noqa: E402

END = dt.date(2026, 10, 16)
SEED = 42


def read_load(folder: Path) -> dict[str, list[dict]]:
    out = {}
    for i, t in enumerate(TABLE_ORDER):
        f = folder / f"{i:02d}_{t}.jsonl"
        out[t] = [json.loads(x) for x in f.read_text(encoding="utf8").splitlines() if x.strip()]
    return out


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    root = tmp_path_factory.mktemp("synth")
    out = {}
    for key in ("halal_ilford", "halal_ilford_messy"):
        generate(key, SEED, END, inputs=False, out_root=root / "a", fixtures_root=root / "fx")
        base = root / "a" / key
        out[key] = {"rows": read_load(base / "load"), "gt": json.loads((base / "ground_truth.json").read_text(encoding="utf8")),
                    "dir": base}
    out["_root"] = root
    return out
