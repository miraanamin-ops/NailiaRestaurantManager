"""The models this service runs. Adding one: a file in this folder with a SPEC,
and one register() line below (see registry.py for the rest)."""

from __future__ import annotations

from ..registry import Registry
from . import forecast_baseline


def register_models(reg: Registry) -> None:
    reg.register(forecast_baseline.SPEC)
