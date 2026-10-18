"""The model registry, and the database helpers' own limits (checked before any query runs)."""

from __future__ import annotations

import dataclasses

import pytest

from dinerai_analytics.db import NotAllowed, ViewReader, insert_rows
from dinerai_analytics.models import forecast_baseline
from dinerai_analytics.registry import ModelResult, ModelSpec, PermanentError, Registry, RegistryError, load_registry


def _run(ctx):
    return ModelResult(outputs={}, metrics={}, score=None, passed=True)


def spec(**kw) -> ModelSpec:
    base = dict(name="m_one", version="1.0.0", kind="forecast", role="benchmark", job_type="m_one", views=("sales_daily",), run=_run)
    return ModelSpec(**{**base, **kw})


def test_the_built_in_models():
    reg = load_registry()
    assert reg.job_types == ["forecast_baseline", "forecast_daily", "forecast_refresh"]
    s = reg.for_job_type("forecast_baseline")
    assert s is forecast_baseline.SPEC
    assert (s.role, s.kind, s.views) == ("benchmark", "forecast", ("sales_daily", "sales_channels"))
    # The real forecast is production (shown once it passes); its 07:00 refresh too.
    assert [(x.name, x.role) for x in (reg.for_job_type("forecast_daily"), reg.for_job_type("forecast_refresh"))] == [
        ("forecast_daily", "production"), ("forecast_refresh", "production")]


def test_register_and_look_up():
    reg = Registry()
    reg.register(spec())
    reg.register(spec(name="m_two", job_type="m_two", role="production"))
    assert reg.job_types == ["m_one", "m_two"]
    assert reg.by_name("m_two").role == "production"
    with pytest.raises(PermanentError, match="No model is registered for job type 'morning'"):
        reg.for_job_type("morning")
    with pytest.raises(RegistryError, match="No model called"):
        reg.by_name("nope")


def test_duplicates_are_refused():
    reg = Registry()
    reg.register(spec())
    with pytest.raises(RegistryError, match="already registered"):
        reg.register(spec(name="m_other"))  # same job type
    with pytest.raises(RegistryError, match="already registered"):
        reg.register(spec(job_type="m_other"))  # same name


@pytest.mark.parametrize("change, message", [
    ({"role": "shown"}, "role must be benchmark or production"),
    ({"role": None}, "role must be benchmark or production"),
    ({"kind": "magic"}, "kind must be"),
    ({"version": "1"}, "version"),
    ({"name": "Bad Name"}, "lower_snake_case"),
    ({"views": ()}, "declare the analytics views"),
    ({"views": ("sales_daily; drop table x",)}, "declare the analytics views"),
    ({"run": None}, "run must be a function"),
    ({"time_budget_s": 0}, "positive"),
])
def test_invalid_specs(change, message):
    with pytest.raises(RegistryError, match=message):
        Registry().register(dataclasses.replace(spec(), **change))


def test_extra_test_models_load():
    reg = load_registry(("dinerai_test_models",))
    assert "test_fail" in reg.job_types and "forecast_baseline" in reg.job_types


class _NoQueries:
    """A connection that fails the test if any query is attempted."""

    def cursor(self):
        raise AssertionError("no query should run")


def test_a_model_reads_only_its_declared_views():
    reader = ViewReader(_NoQueries(), "r-1", ["sales_daily"])
    with pytest.raises(NotAllowed, match="isn't one of this model's declared views"):
        reader.rows("staff", ["id"])
    with pytest.raises(NotAllowed, match="Operator"):
        reader.rows("sales_daily", ["day"], where=[("day", "; delete", 1)])
    with pytest.raises(NotAllowed, match="Name the columns"):
        reader.rows("sales_daily", [])


def test_writes_only_go_to_output_tables():
    with pytest.raises(NotAllowed, match="isn't a model output table"):
        insert_rows(_NoQueries(), "restaurants", [{"id": 1}])
    with pytest.raises(NotAllowed, match="same columns"):
        insert_rows(_NoQueries(), "forecasts", [{"a": 1}, {"b": 2}])
    assert insert_rows(_NoQueries(), "forecasts", []) == 0
