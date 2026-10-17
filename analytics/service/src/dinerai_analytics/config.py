"""Settings for one environment (dev or prod), and the guard rails around them.

Settings come only from what is named on the command line:
  --env <file>     a KEY=value file (outside OneDrive), for local runs
  --env process    the process environment (Railway sets variables there)

Keys:
  DATABASE_URL       the queue_worker login (Supabase > Connect > Session pooler,
                     user queue_worker.<project-ref>). Never the postgres user.
  ANALYTICS_ENV      dev or prod; must match the project in DATABASE_URL.
  POLL_SECONDS       optional, how long an idle worker waits before looking again (15)
  SHUTDOWN_GRACE_SECONDS  optional, how long a stopping worker lets a job finish (20)
  EXTRA_MODELS       dev only: extra model modules to load (tests use it)

Refused: a file inside OneDrive, a user other than queue_worker, any Supabase
secret key in the settings, a dev/prod label that doesn't match the project,
and production unless --allow-production is given as well.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit

# DinerAI's production Supabase project (the same ref the generator refuses).
PRODUCTION_REF = "gfrkcvcqmdhdhpcytlkc"
WORKER_ROLE = "queue_worker"
# Settings that would let the service act as the app. Never accepted.
FORBIDDEN_KEYS = ("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY")
KNOWN_KEYS = ("DATABASE_URL", "ANALYTICS_ENV", "POLL_SECONDS", "SHUTDOWN_GRACE_SECONDS", "EXTRA_MODELS")


class Refused(Exception):
    """A setting the service won't run with."""


@dataclass(frozen=True)
class Config:
    env: str  # "dev" or "prod"
    database_url: str = field(repr=False)
    poll_seconds: float = 15.0
    shutdown_grace_seconds: float = 20.0
    extra_models: tuple[str, ...] = ()

    @property
    def target(self) -> str:
        """user@host, for logs (never the password)."""
        u = urlsplit(self.database_url)
        return f"{unquote(u.username or '?')}@{u.hostname or '?'}"

    def to_dict(self) -> dict:
        """For handing to a job's own process."""
        return {
            "env": self.env,
            "database_url": self.database_url,
            "poll_seconds": self.poll_seconds,
            "shutdown_grace_seconds": self.shutdown_grace_seconds,
            "extra_models": list(self.extra_models),
        }

    @classmethod
    def from_dict(cls, d: dict) -> Config:
        return cls(
            env=d["env"],
            database_url=d["database_url"],
            poll_seconds=d["poll_seconds"],
            shutdown_grace_seconds=d["shutdown_grace_seconds"],
            extra_models=tuple(d["extra_models"]),
        )


def read_env_file(path: str) -> dict[str, str]:
    p = Path(path).expanduser().resolve()
    if any(part.lower().startswith("onedrive") for part in p.parts):
        raise Refused(f"{p} is inside OneDrive. Keep env files outside it (for example C:\\Users\\<you>\\dev\\analytics-dev.env).")
    if not p.is_file():
        raise Refused(f"No env file at {p}")
    env: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        env[k.strip()] = v
    return env


def read_settings(source: str) -> dict[str, str]:
    """The settings named on the command line: a file, or 'process' for the environment."""
    if source == "process":
        settings = {k: os.environ[k] for k in KNOWN_KEYS if k in os.environ}
        settings.update({k: os.environ[k] for k in FORBIDDEN_KEYS if k in os.environ})
        return settings
    return read_env_file(source)


def is_production(url: str) -> bool:
    return PRODUCTION_REF in url


def db_user(url: str) -> str:
    return unquote(urlsplit(url).username or "")


def _number(settings: dict[str, str], key: str, default: float) -> float:
    raw = settings.get(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError as e:
        raise Refused(f"{key}={raw!r} isn't a number") from e
    if value < 0:
        raise Refused(f"{key} can't be negative")
    return value


def build_config(settings: dict[str, str], allow_production: bool = False) -> Config:
    present = [k for k in FORBIDDEN_KEYS if settings.get(k)]
    if present:
        raise Refused(f"The settings contain {', '.join(present)}. The analytics service only ever uses the queue_worker login; remove it.")

    url = settings.get("DATABASE_URL", "").strip()
    if not url:
        raise Refused("No DATABASE_URL (the queue_worker connection string).")
    if not url.startswith(("postgresql://", "postgres://")):
        raise Refused("DATABASE_URL must be a postgresql:// connection string.")
    user = db_user(url)
    # Supabase's pooler names the user queue_worker.<project-ref>.
    if user != WORKER_ROLE and not user.startswith(WORKER_ROLE + "."):
        raise Refused(f"DATABASE_URL logs in as {user or 'nobody'!r}. The analytics service only connects as {WORKER_ROLE}.")

    env = settings.get("ANALYTICS_ENV", "").strip().lower()
    if env not in ("dev", "prod"):
        raise Refused("ANALYTICS_ENV must be dev or prod.")
    prod_url = is_production(url)
    if env == "dev" and prod_url:
        raise Refused("ANALYTICS_ENV is dev but DATABASE_URL is the PRODUCTION project.")
    if env == "prod" and not prod_url:
        raise Refused("ANALYTICS_ENV is prod but DATABASE_URL isn't the production project.")
    if env == "prod" and not allow_production:
        raise Refused("This is the PRODUCTION project. Add --allow-production to run against it.")

    extra = tuple(m.strip() for m in settings.get("EXTRA_MODELS", "").split(",") if m.strip())
    if extra and env != "dev":
        raise Refused("EXTRA_MODELS is only allowed in dev.")

    return Config(
        env=env,
        database_url=url,
        poll_seconds=_number(settings, "POLL_SECONDS", 15.0),
        shutdown_grace_seconds=_number(settings, "SHUTDOWN_GRACE_SECONDS", 20.0),
        extra_models=extra,
    )


def load_config(source: str, allow_production: bool = False) -> Config:
    return build_config(read_settings(source), allow_production=allow_production)
