"""
Database helper — thin wrapper around psycopg for the Python agents.

All agents import `get_conn()` from here. Uses DATABASE_URL from .env.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

# Override=True: shell-set empty strings should not mask real values in .env.
load_dotenv(override=True)


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set in environment")
    return url


@contextmanager
def get_conn(autocommit: bool = True) -> Iterator[psycopg.Connection]:
    """Yield a psycopg connection with dict_row row factory."""
    with psycopg.connect(_database_url(), autocommit=autocommit, row_factory=dict_row) as conn:
        yield conn


def get_config(key: str, default: str | None = None) -> str | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT value FROM system_config WHERE key = %s", (key,))
        row = cur.fetchone()
        return row["value"] if row else default


def set_config(key: str, value: str) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO system_config (key, value) VALUES (%s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (key, value),
        )
