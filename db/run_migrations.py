"""
Run all SQL migrations in db/migrations/ in alphabetical order
against the DATABASE_URL defined in .env.

Usage:
    python db/run_migrations.py

Idempotent: each migration file uses IF NOT EXISTS / DO $$ guards.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def main() -> int:
    load_dotenv()
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set in .env", file=sys.stderr)
        return 1

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("No migration files found.")
        return 0

    print(f"Connecting to database...")
    with psycopg.connect(db_url, autocommit=True) as conn:
        for sql_file in files:
            print(f"--> Applying {sql_file.name} ...", end=" ", flush=True)
            sql = sql_file.read_text(encoding="utf-8")
            with conn.cursor() as cur:
                cur.execute(sql)
            print("OK")

    print("All migrations applied successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
