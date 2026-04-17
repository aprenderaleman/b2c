"""
Agent 3 — DELIVERY AGENT (El Enviador).

Pure code, no AI. Takes an approved message + a lead and:

  1. Respects rate-limit / send-window rules.
  2. Calls the WhatsApp service to send the text.
  3. Retries up to 3 times with exponential backoff on failure.
  4. Logs the send to message_send_log and to lead_timeline.
  5. Advances the lead's follow-up number and computes next_contact_date.
  6. Alerts Gelfis if all retries fail.

Public surface:

    send_approved(lead, text, *, is_new_conversation=False) -> SendResult

`lead` is a dict as returned by shared.leads.get_lead(...).
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime

from agents.shared.db import get_config, get_conn
from agents.shared.leads import (
    log_timeline,
    schedule_next_contact,
    update_status,
    was_message_ever_seen,
)
from agents.shared.rate_limits import (
    can_send_now,
    random_delay_seconds,
)
from agents.whatsapp_service import WhatsAppError, WhatsAppService

log = logging.getLogger("agent_3")


@dataclass
class SendResult:
    success: bool
    reason: str = ""
    message_id: str | None = None
    retries: int = 0


_MAX_RETRIES = 3


def _active_instance() -> str:
    return get_config("active_whatsapp_instance") or "aprender-aleman-main"


def send_approved(
    lead: dict,
    text: str,
    *,
    is_new_conversation: bool = False,
    wa: WhatsAppService | None = None,
) -> SendResult:
    instance = _active_instance()

    # 1. Rate-limit / window check.
    gate = can_send_now(instance, is_new_conversation=is_new_conversation)
    if gate != "ok":
        log.info("Blocked send for lead %s: %s", lead["id"], gate)
        _log_send_blocked(lead["id"], instance, gate, text)
        return SendResult(success=False, reason=f"blocked:{gate}")

    wa = wa or WhatsAppService()

    # 2. Send with retries.
    delay = 2.0
    err: str = ""
    for attempt in range(_MAX_RETRIES):
        try:
            msg_id = wa.send_text(instance, lead["whatsapp_normalized"], text)
            _log_sent(lead["id"], instance, lead["whatsapp_normalized"], text, msg_id, attempt)
            _advance_lead_after_send(lead["id"])
            return SendResult(success=True, message_id=msg_id, retries=attempt)
        except WhatsAppError as e:
            err = str(e)
            log.warning("Send attempt %d failed for lead %s: %s", attempt + 1, lead["id"], err)
            time.sleep(delay)
            delay *= 2

    # 3. All retries failed.
    _log_send_failed(lead["id"], instance, lead["whatsapp_normalized"], text, err)
    _alert_gelfis_send_failed(lead, err)
    return SendResult(success=False, reason=f"error:{err}", retries=_MAX_RETRIES)


# ──────────────────────────────────────────────────────────
# DB / logging helpers
# ──────────────────────────────────────────────────────────


def _log_sent(
    lead_id: str,
    instance: str,
    to: str,
    text: str,
    message_id: str,
    retries: int,
) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO message_send_log
                (lead_id, instance, to_number, message_body, success, retry_count, metadata)
            VALUES (%s, %s, %s, %s, TRUE, %s, %s::jsonb)
            """,
            (lead_id, instance, to, text, retries, f'{{"message_id":"{message_id}"}}'),
        )
    log_timeline(
        lead_id,
        type="system_message_sent",
        author="agent_3",
        content=text,
        metadata={"instance": instance, "message_id": message_id, "retries": retries},
    )


def _log_send_blocked(lead_id: str, instance: str, reason: str, text: str) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO message_send_log
                (lead_id, instance, to_number, message_body, success, error_message, metadata)
            VALUES (%s, %s, %s, %s, FALSE, %s, %s::jsonb)
            """,
            (
                lead_id, instance, "(deferred)", text,
                f"blocked:{reason}",
                '{"deferred": true}',
            ),
        )


def _log_send_failed(
    lead_id: str,
    instance: str,
    to: str,
    text: str,
    err: str,
) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO message_send_log
                (lead_id, instance, to_number, message_body, success, error_message, retry_count)
            VALUES (%s, %s, %s, %s, FALSE, %s, %s)
            """,
            (lead_id, instance, to, text, err[:600], _MAX_RETRIES),
        )
    log_timeline(
        lead_id,
        type="send_failed",
        author="agent_3",
        content=f"Send failed after {_MAX_RETRIES} retries: {err[:200]}",
    )


def _advance_lead_after_send(lead_id: str) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE leads
               SET current_followup_number = current_followup_number + 1
             WHERE id = %s
            RETURNING current_followup_number, status
            """,
            (lead_id,),
        )
        row = cur.fetchone()
    if not row:
        return
    n = int(row["current_followup_number"])
    ever_seen = was_message_ever_seen(lead_id)
    schedule_next_contact(lead_id, n, ever_seen=ever_seen)


def _alert_gelfis_send_failed(lead: dict, err: str) -> None:
    """
    Writes an escalation to the timeline. The actual WhatsApp ping to Gelfis
    is handled by the notifications module (step 12); here we just record it.
    """
    log_timeline(
        lead["id"],
        type="escalation",
        author="agent_3",
        content=f"Send failure — needs attention. Error: {err[:300]}",
        metadata={"alert_gelfis": True, "failed_at": datetime.utcnow().isoformat()},
    )
