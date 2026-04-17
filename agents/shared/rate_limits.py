"""
Rate limit + send-window enforcement — shared by Agent 0 and Agent 3.

Rules (from the spec):
  * max 40 new conversations / day
  * max 10 outbound messages / hour
  * no sends between 22:00 and 08:00 Europe/Berlin
  * no sends on Sundays
  * random delay 30–90s between messages

All enforced from the DB so the rules hold across process restarts and
even across multiple agent instances.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Literal

import pytz

from .db import get_config, get_conn

BERLIN = pytz.timezone("Europe/Berlin")


def _now_berlin() -> datetime:
    return datetime.now(BERLIN)


def in_send_window(now: datetime | None = None) -> bool:
    """True if now is within the configured send window and not a Sunday."""
    n = now or _now_berlin()
    if n.weekday() == 6 and _bool_config("skip_sundays", True):
        return False
    start = int(get_config("send_window_start_hour") or 8)
    end = int(get_config("send_window_end_hour") or 22)
    return start <= n.hour < end


def _bool_config(key: str, default: bool) -> bool:
    v = get_config(key)
    if v is None:
        return default
    return str(v).strip().lower() in ("true", "1", "yes")


def hourly_budget_remaining(instance: str) -> int:
    cap = int(get_config("max_outbound_messages_per_hour") or 10)
    cutoff = _now_berlin() - timedelta(hours=1)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS n FROM message_send_log
            WHERE instance = %s AND success = TRUE AND sent_at >= %s
            """,
            (instance, cutoff),
        )
        row = cur.fetchone()
    used = int(row["n"]) if row else 0
    return max(0, cap - used)


def daily_new_conversations_remaining() -> int:
    """
    A 'new conversation' == a message sent to a lead in status 'new'.
    Counts today (Berlin day) across all instances.
    """
    cap = int(get_config("max_new_conversations_per_day") or 40)
    start_of_day = _now_berlin().replace(hour=0, minute=0, second=0, microsecond=0)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(DISTINCT l.id) AS n
              FROM message_send_log m
              JOIN leads l ON l.id = m.lead_id
             WHERE m.success = TRUE
               AND m.sent_at >= %s
               AND l.current_followup_number = 1
            """,
            (start_of_day,),
        )
        row = cur.fetchone()
    used = int(row["n"]) if row else 0
    return max(0, cap - used)


def random_delay_seconds() -> float:
    lo = int(get_config("min_delay_seconds") or 30)
    hi = int(get_config("max_delay_seconds") or 90)
    if hi < lo:
        lo, hi = hi, lo
    return random.uniform(lo, hi)


SendBlockReason = Literal["ok", "out_of_window", "hourly_cap", "daily_cap", "paused"]


def can_send_now(instance: str, is_new_conversation: bool) -> SendBlockReason:
    if _bool_config("system_paused", False):
        return "paused"
    if not in_send_window():
        return "out_of_window"
    if hourly_budget_remaining(instance) <= 0:
        return "hourly_cap"
    if is_new_conversation and daily_new_conversations_remaining() <= 0:
        return "daily_cap"
    return "ok"
