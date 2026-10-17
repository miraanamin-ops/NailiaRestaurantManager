"""Shared set-up: the test models module (dinerai_test_models.py, next to this file)
must be importable, also in the job processes the worker starts."""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
