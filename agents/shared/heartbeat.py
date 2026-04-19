"""
Heartbeat + critical-issue helpers for the self-healing layer.

    beat("scheduler", note="tick ok", details={"leads_due": 3})
    note_critical("Evolution API connectionState=close after 3 restart tries")
    clear_critical()

All operations commit eagerly — a heartbeat write must be visible to other
processes immediately so the janitor can detect staleness.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from .db import get_conn, set_config


def beat(service: str, note: str | None = None, details: dict | None = None) -> None:
    """Record a heartbeat tick for `service`. Creates the row if absent."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO system_heartbeat (service, last_tick, cycle_count, last_note, details)
            VALUES (%s, NOW(), 1, %s, %s::jsonb)
            ON CONFLICT (service) DO UPDATE
                SET last_tick   = NOW(),
                    cycle_count = system_heartbeat.cycle_count + 1,
                    last_note   = EXCLUDED.last_note,
                    details     = EXCLUDED.details
            """,
            (service, note or "", json.dumps(details or {})),
        )


def last_beat(service: str) -> datetime | None:
    """Return the most recent heartbeat for `service`, or None if never seen."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT last_tick FROM system_heartbeat WHERE service = %s",
            (service,),
        )
        row = cur.fetchone()
        return row["last_tick"] if row else None


def minutes_since_beat(service: str) -> float | None:
    """Minutes since the last heartbeat for `service`, or None if unknown."""
    t = last_beat(service)
    if t is None:
        return None
    now = datetime.now(timezone.utc)
    return (now - t).total_seconds() / 60


def note_critical(message: str) -> None:
    """
    Record a critical issue that the admin banner will surface. Replaces
    any previous message — the banner shows only the latest.
    """
    set_config("last_critical_issue", f"{datetime.now(timezone.utc).isoformat()} | {message}")


def clear_critical() -> None:
    """Clear the admin banner once an issue was auto-resolved."""
    set_config("last_critical_issue", "")
