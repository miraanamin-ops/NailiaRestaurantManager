"""Database access: reading the analytics views and writing model outputs.

The login is queue_worker (config.py), which the database lets do three things:
read the analytics.* views (analytics_reader), add rows to the model output
tables and finish runs (model_writer), and call the ext_* queue functions.
This module narrows that further: a model reads only the views it declared,
and every name and value goes through psycopg's quoting and parameters.
"""

from __future__ import annotations

import datetime as dt
import json
from collections.abc import Iterable, Sequence
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import Config

# The tables model_writer may add rows to (supabase/035, 033, 040).
OUTPUT_TABLES = frozenset({"model_runs", "forecasts", "suggested_rotas", "suggested_rota_shifts", "menu_analysis", "finance_snapshots", "deal_outcomes",
                           "model_coefficients", "forecast_drivers"})
OPERATORS = frozenset({"=", "<", "<=", ">", ">=", "<>"})


class NotAllowed(Exception):
    """A read or write outside what the model declared, or outside model_writer's tables."""


def connect(cfg: Config) -> psycopg.Connection:
    # prepare_threshold=None: Supabase's pooler doesn't keep prepared statements.
    return psycopg.connect(cfg.database_url, autocommit=True, prepare_threshold=None, row_factory=dict_row,
                           application_name="dinerai-analytics", connect_timeout=15)


class ViewReader:
    """Reads analytics.<view>, only for the views it was given, always for one restaurant."""

    def __init__(self, conn: psycopg.Connection, restaurant_id: str, views: Iterable[str]):
        self.conn = conn
        self.restaurant_id = restaurant_id
        self.views = frozenset(views)

    def rows(
        self,
        view: str,
        columns: Sequence[str],
        where: Sequence[tuple[str, str, Any]] = (),
        null: Sequence[str] = (),
        order_by: Sequence[str] = (),
        restaurant_column: str | None = "restaurant_id",
    ) -> list[dict]:
        """select columns from analytics.view where restaurant_column = <this restaurant> and each (column, op, value)
        and each column in `null` is null, ordered by order_by."""
        if view not in self.views:
            raise NotAllowed(f"analytics.{view} isn't one of this model's declared views ({', '.join(sorted(self.views)) or 'none'})")
        if not columns:
            raise NotAllowed("Name the columns to read")
        conditions: list[sql.Composable] = []
        params: list[Any] = []
        if restaurant_column:
            conditions.append(sql.SQL("{} = %s").format(sql.Identifier(restaurant_column)))
            params.append(self.restaurant_id)
        for col, op, value in where:
            if op not in OPERATORS:
                raise NotAllowed(f"Operator {op!r} isn't allowed")
            conditions.append(sql.SQL("{} {} %s").format(sql.Identifier(col), sql.SQL(op)))
            params.append(value)
        for col in null:
            conditions.append(sql.SQL("{} is null").format(sql.Identifier(col)))
        query = sql.SQL("select {cols} from {view}").format(
            cols=sql.SQL(", ").join(sql.Identifier(c) for c in columns),
            view=sql.Identifier("analytics", view),
        )
        if conditions:
            query += sql.SQL(" where ") + sql.SQL(" and ").join(conditions)
        if order_by:
            query += sql.SQL(" order by ") + sql.SQL(", ").join(sql.Identifier(c) for c in order_by)
        with self.conn.cursor() as cur:
            cur.execute(query, params)
            return cur.fetchall()


def _value(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return Jsonb(v)
    return v


def insert_rows(conn: psycopg.Connection, table: str, rows: list[dict]) -> int:
    """Add rows to one output table. Every row must have the same columns. Never reads anything back."""
    if table not in OUTPUT_TABLES:
        raise NotAllowed(f"{table} isn't a model output table")
    if not rows:
        return 0
    cols = list(rows[0].keys())
    for r in rows:
        if list(r.keys()) != cols:
            raise NotAllowed(f"Rows for {table} must all have the same columns")
    query = sql.SQL("insert into {t} ({cols}) values ({vals})").format(
        t=sql.Identifier("public", table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in cols),
        vals=sql.SQL(", ").join(sql.Placeholder() for _ in cols),
    )
    with conn.cursor() as cur:
        cur.executemany(query, [[_value(r[c]) for c in cols] for r in rows])
    return len(rows)


def finish_run(conn: psycopg.Connection, run_id: str, status: str, metrics: dict | None = None,
               score: float | None = None, passed: bool | None = None) -> bool:
    """finish_model_run (035): the only change queue_worker may make to a run, and only while it's running."""
    with conn.cursor() as cur:
        cur.execute("select finish_model_run(%s::uuid, %s::text, %s::jsonb, %s::numeric, %s::boolean) as ok",
                    (run_id, status, json.dumps(metrics, default=str) if metrics is not None else None, score, passed))
        return bool(cur.fetchone()["ok"])


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)
