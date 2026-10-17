"""The model registry: what each model is, what it reads, and how it runs.

Adding a model: one file in models/ with a SPEC, plus one register() line in
models/__init__.py. Then give its job type a row in job_types (a numbered SQL
file, runner 'external'), and for a nightly model add it to NIGHTLY_MODELS in
src/lib/queue/config.ts.

A model's run function only reads data (through ctx.reader, limited to its
declared views) and returns a ModelResult. The runner (runner.py) does the rest:
it creates the model_runs row, writes the outputs tied to that run, and
finishes the run with status, metrics, score and passed.
"""

from __future__ import annotations

import datetime as dt
import importlib
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .db import ViewReader

Role = Literal["benchmark", "production"]
Kind = Literal["forecast", "rota", "menu", "finance", "deal", "other"]
ROLES = ("benchmark", "production")
KINDS = ("forecast", "rota", "menu", "finance", "deal", "other")
# Output tables a model may return rows for (the runner adds model_run_id, restaurant_id and issued_at).
MODEL_OUTPUTS = ("forecasts", "suggested_rotas", "suggested_rota_shifts", "menu_analysis", "finance_snapshots", "deal_outcomes")
_NAME = re.compile(r"^[a-z][a-z0-9_]{1,62}$")
_VERSION = re.compile(r"^\d+\.\d+\.\d+$")


class RegistryError(Exception):
    pass


class PermanentError(Exception):
    """A failure retrying can't fix (no data, a bad job). The job dies without using its other tries."""


@dataclass(frozen=True)
class RunContext:
    restaurant_id: str
    reader: ViewReader
    payload: dict
    issue_time: dt.datetime  # when the forecast is issued (UTC); the data cut-off
    issue_day: dt.date  # the London date of issue_time
    known_through: dt.date  # the last trading day that had ended by issue_time
    trading_day_cutoff_hour: int


@dataclass
class ModelResult:
    outputs: dict[str, list[dict]]  # table -> rows (without model_run_id, restaurant_id, issued_at)
    metrics: dict
    score: float | None
    passed: bool


@dataclass(frozen=True)
class ModelSpec:
    name: str
    version: str
    kind: Kind
    role: Role  # benchmark: a yardstick, never shown to an owner; production: shown once it passes
    job_type: str
    views: tuple[str, ...]  # the analytics.* views it reads (nothing else is allowed)
    run: Callable[[RunContext], ModelResult]
    time_budget_s: int = 600  # the job is stopped after this long
    history_days: int = 365  # how far back it reads (recorded as the run's data window)
    backtest_metric: str | None = None  # "WAPE", recorded on the run
    params: dict = field(default_factory=dict)

    def validate(self) -> None:
        if not _NAME.match(self.name):
            raise RegistryError(f"Model name {self.name!r} must be lower_snake_case")
        if not _NAME.match(self.job_type):
            raise RegistryError(f"{self.name}: job type {self.job_type!r} must be lower_snake_case")
        if not _VERSION.match(self.version):
            raise RegistryError(f"{self.name}: version {self.version!r} must look like 1.0.0")
        if self.kind not in KINDS:
            raise RegistryError(f"{self.name}: kind must be one of {', '.join(KINDS)}")
        if self.role not in ROLES:
            raise RegistryError(f"{self.name}: role must be benchmark or production")
        if not self.views or any(not _NAME.match(v) for v in self.views):
            raise RegistryError(f"{self.name}: declare the analytics views it reads")
        if not callable(self.run):
            raise RegistryError(f"{self.name}: run must be a function")
        if self.time_budget_s <= 0 or self.history_days <= 0:
            raise RegistryError(f"{self.name}: time budget and history must be positive")


class Registry:
    def __init__(self) -> None:
        self._by_job_type: dict[str, ModelSpec] = {}

    def register(self, spec: ModelSpec) -> ModelSpec:
        spec.validate()
        if spec.job_type in self._by_job_type:
            raise RegistryError(f"Job type {spec.job_type!r} is already registered (by {self._by_job_type[spec.job_type].name})")
        if any(s.name == spec.name for s in self._by_job_type.values()):
            raise RegistryError(f"Model {spec.name!r} is already registered")
        self._by_job_type[spec.job_type] = spec
        return spec

    def for_job_type(self, job_type: str) -> ModelSpec:
        try:
            return self._by_job_type[job_type]
        except KeyError:
            raise PermanentError(f"No model is registered for job type {job_type!r}") from None

    def by_name(self, name: str) -> ModelSpec:
        for s in self._by_job_type.values():
            if s.name == name:
                return s
        raise RegistryError(f"No model called {name!r} (known: {', '.join(sorted(s.name for s in self._by_job_type.values()))})")

    @property
    def job_types(self) -> list[str]:
        return sorted(self._by_job_type)

    @property
    def specs(self) -> list[ModelSpec]:
        return [self._by_job_type[t] for t in self.job_types]


def load_registry(extra_modules: tuple[str, ...] = ()) -> Registry:
    """The built-in models (models/__init__.py), plus extra modules in dev (tests). Each extra
    module exposes register_models(registry)."""
    from .models import register_models

    reg = Registry()
    register_models(reg)
    for name in extra_modules:
        importlib.import_module(name).register_models(reg)
    return reg
