"""
Outbound retry queue helpers.

The funnel + every agent send WhatsApp messages through the same
Evolution-API instance. When Evolution's Baileys session is
disconnected (a regular occurrence with multi-device WhatsApp), our
sends return http_503 and the message is lost. This module is the
safety net.

  enqueue_for_retry(...)   — register a failed send for a future retry.
  drain(...)               — called by the scheduler tick every 30 s.

Backoff schedule (in seconds, by attempt number):
   1 → 30     2 → 60     3 → 120    4 → 300    5 → 900    6 → 3600
   7th attempt → mark failed_permanent (admin sees on /admin/system).

Permanent errors (invalid number, blocked) are detected by message
substring on the WhatsAppError text and skip the retry ladder
entirely.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from agents.shared.db import get_conn

log = logging.getLogger("outbound_queue")

# Attempt N → seconds-from-now-to-retry. Index 0 is unused.
BACKOFF_SECONDS = [0, 30, 60, 120, 300, 900, 3600]
MAX_ATTEMPTS    = len(BACKOFF_SECONDS) - 1  # 6


# Substrings that mark a permanent failure — we won't retry these.
_PERMANENT_HINTS = (
    "not on whatsapp",
    "invalid wa.me",
    "number does not exist",
    "block",                 # blocked by user
    "phone is not registered",
)


def _is_permanent_error(error: str) -> bool:
    e = (error or "").lower()
    return any(h in e for h in _PERMANENT_HINTS)


def enqueue_for_retry(
    *,
    phone_e164: str,
    body:       str,
    kind:       str,
    lead_id:    str | None = None,
    error:      str | None = None,
) -> str | None:
    """Register a message for a future retry attempt.

    Called by the send wrappers when the inline send fails with what
    looks like a transient error. Returns the row id of the queued
    item, or None if we decided not to enqueue (permanent error).
    """
    if error and _is_permanent_error(error):
        log.warning("Refusing to enqueue %s for retry: permanent error %r", phone_e164, error)
        return None

    next_at = datetime.utcnow() + timedelta(seconds=BACKOFF_SECONDS[1])
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO outbound_queue (lead_id, phone_e164, body, kind, attempts, next_attempt_at, last_error)
            VALUES (%s, %s, %s, %s, 0, %s, %s)
            RETURNING id::text
            """,
            (lead_id, phone_e164, body, kind, next_at, (error or "")[:500]),
        )
        row = cur.fetchone()
    return row["id"] if row else None


def drain(send_fn, batch_size: int = 20) -> dict:
    """Pick the rows that are due to send and try them.

    `send_fn(phone, body)` is the callable that actually talks to
    Evolution. It must return either a string (message_id, success)
    or raise an exception (failure). The caller injects this so we
    don't have a hard dep on whatsapp_service here.
    """
    sent      = 0
    requeued  = 0
    failed    = 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, lead_id::text, phone_e164, body, kind, attempts
              FROM outbound_queue
             WHERE status = 'queued'
               AND next_attempt_at <= NOW()
             ORDER BY next_attempt_at ASC
             LIMIT %s
             FOR UPDATE SKIP LOCKED
            """,
            (batch_size,),
        )
        rows = list(cur.fetchall())

    for row in rows:
        try:
            msg_id = send_fn(row["phone_e164"], row["body"])
            _mark_sent(row["id"], msg_id)
            sent += 1
        except Exception as e:                     # noqa: BLE001
            err = str(e)[:500]
            attempts = (row["attempts"] or 0) + 1
            if _is_permanent_error(err) or attempts > MAX_ATTEMPTS:
                _mark_failed(row["id"], err, attempts, row["lead_id"], row["kind"])
                failed += 1
            else:
                _requeue(row["id"], err, attempts)
                requeued += 1

    return {"checked": len(rows), "sent": sent, "requeued": requeued, "failed": failed}


def _mark_sent(queue_id: str, message_id: str | None) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE outbound_queue
               SET status = 'sent',
                   sent_at = now(),
                   updated_at = now(),
                   message_id = %s,
                   last_error = NULL
             WHERE id = %s
            """,
            (message_id, queue_id),
        )


def _requeue(queue_id: str, error: str, attempts: int) -> None:
    delay = BACKOFF_SECONDS[min(attempts, MAX_ATTEMPTS)]
    next_at = datetime.utcnow() + timedelta(seconds=delay)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE outbound_queue
               SET attempts = %s,
                   next_attempt_at = %s,
                   last_error = %s,
                   updated_at = now()
             WHERE id = %s
            """,
            (attempts, next_at, error, queue_id),
        )


def _mark_failed(queue_id: str, error: str, attempts: int, lead_id: str | None, kind: str) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE outbound_queue
               SET status = 'failed_permanent',
                   attempts = %s,
                   last_error = %s,
                   updated_at = now()
             WHERE id = %s
            """,
            (attempts, error, queue_id),
        )
    if lead_id:
        # Lazy import — avoid circular dep with leads.py at module load.
        from agents.shared.leads import log_timeline
        try:
            log_timeline(
                lead_id,
                type="send_failed",
                author="system",
                content=f"WhatsApp send falló tras {attempts} intentos: {error[:120]}",
                metadata={"channel": "whatsapp", "kind": kind, "error": error, "attempts": attempts},
            )
        except Exception as e:                       # noqa: BLE001
            log.warning("Could not write send_failed timeline for lead %s: %s", lead_id, e)


def stats() -> dict:
    """Snapshot for the /admin/system dashboard."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, count(*) FROM outbound_queue GROUP BY status")
        rows = cur.fetchall()
    by_status = {r["status"]: int(r["count"]) for r in rows}
    return {
        "queued":           by_status.get("queued", 0),
        "sent":             by_status.get("sent", 0),
        "failed_permanent": by_status.get("failed_permanent", 0),
    }
