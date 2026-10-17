"""The guard rails shared by load.py and apply_migrations.py.

- Credentials come only from the env file named on the command line, never from a
  default location, and never from a copy of the repo in OneDrive.
- The production Supabase project is recognised by its project ref; loading there is
  refused unless --allow-production is given AND the data is the 3-week fixture.
- Loading respects the app's TEST_TOOLS switch (same rules as src/lib/switches.ts).
"""

from __future__ import annotations

from pathlib import Path

# DinerAI's production Supabase project (app.dinerai.co.uk). Its ref appears in every
# connection string and API URL for it (host db.<ref>.supabase.co or user postgres.<ref>).
PRODUCTION_REF = "gfrkcvcqmdhdhpcytlkc"


class Refused(Exception):
    pass


def read_env(path: str) -> dict[str, str]:
    p = Path(path).expanduser().resolve()
    if any(part.lower().startswith("onedrive") for part in p.parts):
        raise Refused(f"{p} is inside OneDrive. Keep the dev project's env file outside OneDrive (for example C:\\Users\\<you>\\dev\\synth.env).")
    if not p.is_file():
        raise Refused(f"No env file at {p}")
    env = {}
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        env[k.strip()] = v
    if not env.get("DATABASE_URL"):
        raise Refused(f"{p} has no DATABASE_URL (Supabase > Connect > Session pooler connection string).")
    return env


def is_production(env: dict[str, str]) -> bool:
    return any(PRODUCTION_REF in (env.get(k) or "") for k in ("DATABASE_URL", "SUPABASE_URL"))


def read_flag(value: str | None):
    """true/on/yes/1, false/off/no/0 (any case); 'missing' or 'unreadable' otherwise (as readFlag in switches.ts)."""
    if value is None or value.strip() == "":
        return "missing"
    v = value.strip().lower()
    if v in ("true", "on", "yes", "1"):
        return True
    if v in ("false", "off", "no", "0"):
        return False
    return "unreadable"


def test_tools_on(env: dict[str, str]) -> bool:
    own = read_flag(env.get("TEST_TOOLS"))
    if isinstance(own, bool):
        return own
    if own == "unreadable":
        return False
    return env.get("TEST_MODE") == "true"


def describe_target(env: dict[str, str]) -> str:
    url = env["DATABASE_URL"]
    host = url.split("@")[-1].split("/")[0] if "@" in url else "?"
    user = url.split("//")[-1].split(":")[0] if "//" in url else "?"
    return f"{user}@{host}"
