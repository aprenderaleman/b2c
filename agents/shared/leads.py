"""
Lead-domain helpers used by every agent.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

from .db import get_conn

TimelineType = Literal[
    "system_message_sent",
    "lead_message_received",
    "status_change",
    "agent_note",
    "gelfis_note",
    "calendly_event",
    "trial_reminder",
    "conversion",
    "escalation",
    "send_failed",
    "whatsapp_read_receipt",
]

TimelineAuthor = Literal[
    "agent_0", "agent_1", "agent_2", "agent_3", "agent_4", "agent_5",
    "gelfis", "system", "lead",
]


def log_timeline(
    lead_id: str,
    *,
    type: TimelineType,
    author: TimelineAuthor,
    content: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO lead_timeline (lead_id, type, author, content, metadata)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            """,
            (lead_id, type, author, content, _dumps(metadata or {})),
        )


def update_status(lead_id: str, new_status: str, *, author: TimelineAuthor) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT status FROM leads WHERE id = %s",
            (lead_id,),
        )
        row = cur.fetchone()
        if not row or row["status"] == new_status:
            return
        old = row["status"]
        cur.execute(
            "UPDATE leads SET status = %s WHERE id = %s",
            (new_status, lead_id),
        )
    log_timeline(
        lead_id,
        type="status_change",
        author=author,
        content=f"{old} → {new_status}",
    )


def get_lead(lead_id: str) -> dict | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM leads WHERE id = %s", (lead_id,))
        return cur.fetchone()


def get_lead_by_phone(phone_e164: str) -> dict | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM leads WHERE whatsapp_normalized = %s",
            (phone_e164,),
        )
        return cur.fetchone()


def get_recent_timeline(lead_id: str, limit: int = 20) -> list[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT timestamp, type, author, content, metadata
              FROM lead_timeline
             WHERE lead_id = %s
             ORDER BY timestamp DESC
             LIMIT %s
            """,
            (lead_id, limit),
        )
        return list(cur.fetchall())


def get_gelfis_notes(lead_id: str, limit: int = 10) -> list[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT created_at, note
              FROM gelfis_notes
             WHERE lead_id = %s
             ORDER BY created_at DESC
             LIMIT %s
            """,
            (lead_id, limit),
        )
        return list(cur.fetchall())


def was_message_ever_seen(lead_id: str) -> bool:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT messages_seen_count FROM leads WHERE id = %s",
            (lead_id,),
        )
        row = cur.fetchone()
    return bool(row and (row.get("messages_seen_count") or 0) > 0)


def schedule_next_contact(
    lead_id: str,
    followup_number: int,
    *,
    ever_seen: bool,
) -> str | None:
    """
    Compute and persist the next contact date + the status the lead should
    move into. Returns the new status (or None if we're not scheduling
    another contact).

    Spec:
      after contact 1 → +1 day
      after contact 2 → +2 days
      after contact 3 → +4 days (only if ever seen)
      after contact 4 → +7 days
      after contact 5 → mark cold
    Additional rule: after contact 3 without any read receipts → cold.
    """
    next_status: str | None
    days_ahead: int | None

    if followup_number == 1:
        next_status, days_ahead = "contacted_1", 1
    elif followup_number == 2:
        next_status, days_ahead = "contacted_2", 2
    elif followup_number == 3:
        if not ever_seen:
            _mark_cold(lead_id, reason="contact_3 without any read receipts")
            return "cold"
        next_status, days_ahead = "contacted_3", 4
    elif followup_number == 4:
        next_status, days_ahead = "contacted_4", 7
    elif followup_number >= 5:
        _mark_cold(lead_id, reason="reached contact_5")
        return "cold"
    else:
        return None

    next_dt = datetime.utcnow() + timedelta(days=days_ahead)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE leads
               SET status = %s,
                   current_followup_number = %s,
                   next_contact_date = %s
             WHERE id = %s
            """,
            (next_status, followup_number, next_dt, lead_id),
        )
    return next_status


def handle_reactivation_sent(lead_id: str, *, status: str, current_count: int) -> str:
    """
    Llamado por Agent 0 después de un envío exitoso de mensaje de
    reactivación a un lead en estado post-engagement (link_sent /
    in_conversation). Política Gelfis 2026-04-29:

      link_sent + rc=0 → tras enviar primer reminder, schedule final +5d
      link_sent + rc=1 → tras enviar último reminder, mark cold
      in_conversation + rc=0 → tras enviar única reactivación, mark cold

    Devuelve el nuevo status (puede ser el mismo, o 'cold').
    """
    new_count = current_count + 1
    if status == "link_sent":
        if new_count >= 2:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE leads
                       SET reactivation_count = %s,
                           status             = 'cold',
                           next_contact_date  = NULL
                     WHERE id = %s
                    """,
                    (new_count, lead_id),
                )
            log_timeline(
                lead_id, type="status_change", author="agent_0",
                content=f"Cold — link_sent: 2 reactivaciones sin booking.",
            )
            return "cold"
        # Primer reminder enviado → programar segundo en +5d
        next_dt = datetime.utcnow() + timedelta(days=5)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE leads
                   SET reactivation_count = %s,
                       next_contact_date  = %s
                 WHERE id = %s
                """,
                (new_count, next_dt, lead_id),
            )
        return "link_sent"

    if status == "in_conversation":
        # 1 reactivación es el máximo → tras enviarla, cold
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE leads
                   SET reactivation_count = %s,
                       status             = 'cold',
                       next_contact_date  = NULL
                 WHERE id = %s
                """,
                (new_count, lead_id),
            )
        log_timeline(
            lead_id, type="status_change", author="agent_0",
            content="Cold — in_conversation: sin respuesta tras reactivación.",
        )
        return "cold"

    # Statuses no contemplados — solo incrementamos el contador y devolvemos
    # el status actual (no debería ocurrir si compose_message está bien).
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE leads SET reactivation_count = %s WHERE id = %s",
            (new_count, lead_id),
        )
    return status


def reset_reactivation_count(lead_id: str) -> None:
    """Llamado por Agent 4 cuando el lead vuelve a escribir. El lead se
    considera 'engaged' otra vez, así que reseteamos el contador para que
    una futura inactividad arranque desde cero."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE leads SET reactivation_count = 0 WHERE id = %s AND reactivation_count > 0",
            (lead_id,),
        )


def _mark_cold(lead_id: str, *, reason: str) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE leads
               SET status = 'cold',
                   next_contact_date = NULL
             WHERE id = %s
            """,
            (lead_id,),
        )
    log_timeline(
        lead_id,
        type="status_change",
        author="agent_0",
        content=f"Marked cold — {reason}",
    )


def _dumps(obj: Any) -> str:
    import json
    return json.dumps(obj, default=str, ensure_ascii=False)
