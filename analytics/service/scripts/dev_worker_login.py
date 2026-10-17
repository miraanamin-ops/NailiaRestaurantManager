"""Give queue_worker a login on the DEV database and write the service's env file.

  python scripts/dev_worker_login.py --env C:\\Users\\<you>\\dev\\synth.env --out C:\\Users\\<you>\\dev\\analytics-dev.env

- Reads the dev project's admin connection (the generator's synth.env, user
  postgres.<ref>) and refuses the production project, whatever is given.
- Sets a new random password on queue_worker (running it again rotates it) and
  writes --out with the queue_worker connection string and ANALYTICS_ENV=dev.
  The admin connection is never written to --out.
- --out must be outside OneDrive. For production the builder sets the password
  by hand in Supabase's SQL Editor (README, "Deploying").
"""

from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import psycopg
from psycopg import sql

from dinerai_analytics.config import PRODUCTION_REF, Refused, read_env_file


def worker_url(admin_url: str, password: str) -> str:
    u = urlsplit(admin_url)
    user = unquote(u.username or "")
    ref = user.split(".", 1)[1] if "." in user else None  # Supabase pooler: postgres.<ref>
    worker_user = f"queue_worker.{ref}" if ref else "queue_worker"
    host = u.hostname + (f":{u.port}" if u.port else "")
    return f"{u.scheme}://{quote(worker_user)}:{quote(password, safe='')}@{host}{u.path or '/postgres'}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", required=True, help="the dev project's admin env file (DATABASE_URL as postgres)")
    ap.add_argument("--out", required=True, help="where to write the analytics env file (outside OneDrive)")
    a = ap.parse_args(argv)
    try:
        admin = read_env_file(a.env).get("DATABASE_URL", "")
        if not admin:
            raise Refused(f"{a.env} has no DATABASE_URL")
        if PRODUCTION_REF in admin:
            raise Refused("That is the PRODUCTION project. This script only sets up the dev login.")
        out = Path(a.out).expanduser().resolve()
        if any(p.lower().startswith("onedrive") for p in out.parts):
            raise Refused(f"{out} is inside OneDrive. Write it outside (for example C:\\Users\\<you>\\dev\\analytics-dev.env).")
        password = secrets.token_urlsafe(24)
        with psycopg.connect(admin, autocommit=True, prepare_threshold=None) as conn:
            conn.execute(sql.SQL("alter role queue_worker with login password {}").format(sql.Literal(password)))
        out.write_text(
            "# The analytics service's dev settings (queue_worker on dinerai-dev). Made by scripts/dev_worker_login.py.\n"
            f"DATABASE_URL={worker_url(admin, password)}\nANALYTICS_ENV=dev\n",
            encoding="utf-8",
        )
        print(f"queue_worker can now log in to the dev project. Settings written to {out}")
        return 0
    except Refused as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
