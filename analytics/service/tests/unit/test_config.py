"""The guard rails: only queue_worker, never a secret key, dev/prod must match the project,
production only with --allow-production, env files never inside OneDrive."""

from __future__ import annotations

import pytest

from dinerai_analytics.cli import main
from dinerai_analytics.config import PRODUCTION_REF, Refused, build_config, load_config

DEV_URL = "postgresql://queue_worker.devprojectref:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"
PROD_URL = f"postgresql://queue_worker.{PRODUCTION_REF}:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"


def test_a_dev_config():
    cfg = build_config({"DATABASE_URL": DEV_URL, "ANALYTICS_ENV": "dev", "POLL_SECONDS": "5"})
    assert cfg.env == "dev" and cfg.poll_seconds == 5 and cfg.shutdown_grace_seconds == 20
    assert cfg.target == "queue_worker.devprojectref@aws-0-eu-west-2.pooler.supabase.com"
    assert "pw" not in repr(cfg)


@pytest.mark.parametrize("user", ["postgres", "postgres.devprojectref", "service_role", "queue_workerx", "authenticator"])
def test_only_queue_worker_may_connect(user):
    with pytest.raises(Refused, match="only connects as queue_worker"):
        build_config({"DATABASE_URL": f"postgresql://{user}:pw@host:5432/postgres", "ANALYTICS_ENV": "dev"})


@pytest.mark.parametrize("key", ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"])
def test_a_secret_key_in_the_settings_is_refused(key):
    with pytest.raises(Refused, match=key):
        build_config({"DATABASE_URL": DEV_URL, "ANALYTICS_ENV": "dev", key: "sb_secret_x"})


def test_production_needs_the_label_and_the_flag():
    with pytest.raises(Refused, match="PRODUCTION project. Add --allow-production"):
        build_config({"DATABASE_URL": PROD_URL, "ANALYTICS_ENV": "prod"})
    assert build_config({"DATABASE_URL": PROD_URL, "ANALYTICS_ENV": "prod"}, allow_production=True).env == "prod"
    # The flag alone isn't enough: the label must match the project, both ways.
    with pytest.raises(Refused, match="dev but DATABASE_URL is the PRODUCTION"):
        build_config({"DATABASE_URL": PROD_URL, "ANALYTICS_ENV": "dev"}, allow_production=True)
    with pytest.raises(Refused, match="prod but DATABASE_URL isn't the production"):
        build_config({"DATABASE_URL": DEV_URL, "ANALYTICS_ENV": "prod"}, allow_production=True)


@pytest.mark.parametrize("settings, message", [
    ({"ANALYTICS_ENV": "dev"}, "No DATABASE_URL"),
    ({"DATABASE_URL": DEV_URL}, "ANALYTICS_ENV must be dev or prod"),
    ({"DATABASE_URL": DEV_URL, "ANALYTICS_ENV": "staging"}, "ANALYTICS_ENV must be dev or prod"),
    ({"DATABASE_URL": "mysql://queue_worker@x/y", "ANALYTICS_ENV": "dev"}, "postgresql://"),
    ({"DATABASE_URL": DEV_URL, "ANALYTICS_ENV": "dev", "POLL_SECONDS": "soon"}, "isn't a number"),
])
def test_bad_settings(settings, message):
    with pytest.raises(Refused, match=message):
        build_config(settings)


def test_extra_models_only_in_dev():
    assert build_config({"DATABASE_URL": DEV_URL, "ANALYTICS_ENV": "dev", "EXTRA_MODELS": "a, b"}).extra_models == ("a", "b")
    with pytest.raises(Refused, match="only allowed in dev"):
        build_config({"DATABASE_URL": PROD_URL, "ANALYTICS_ENV": "prod", "EXTRA_MODELS": "a"}, allow_production=True)


def test_env_files(tmp_path):
    good = tmp_path / "analytics-dev.env"
    good.write_text(f"# dev\nDATABASE_URL='{DEV_URL}'\nANALYTICS_ENV=dev\n", encoding="utf-8")
    assert load_config(str(good)).env == "dev"
    od = tmp_path / "OneDrive" / "x.env"
    od.parent.mkdir()
    od.write_text(f"DATABASE_URL={DEV_URL}\nANALYTICS_ENV=dev\n")
    with pytest.raises(Refused, match="OneDrive"):
        load_config(str(od))
    with pytest.raises(Refused, match="No env file"):
        load_config(str(tmp_path / "missing.env"))


def test_process_settings(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", DEV_URL)
    monkeypatch.setenv("ANALYTICS_ENV", "dev")
    assert load_config("process").env == "dev"
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "x")
    with pytest.raises(Refused, match="SUPABASE_SECRET_KEY"):
        load_config("process")


def test_the_command_line_refuses_production_without_the_flag(tmp_path, capsys):
    f = tmp_path / "prod.env"
    f.write_text(f"DATABASE_URL={PROD_URL}\nANALYTICS_ENV=prod\n")
    assert main(["worker", "--env", str(f)]) == 2
    assert "PRODUCTION" in capsys.readouterr().err
