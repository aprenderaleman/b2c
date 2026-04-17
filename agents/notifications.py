"""
Notifications → Gelfis's personal WhatsApp.

Per spec, fire a ping to GELFIS_PERSONAL_WHATSAPP when:
  1. A lead enters 'needs_human'.
  2. A trial starts in 30 minutes.
  3. Agent 2 rejected a draft twice (manual review needed).
  4. WhatsApp send failed after 3 retries.
  5. Daily summary at 19:00 Europe/Berlin.

De-duplication: we key each notification by (lead_id, kind, day) and
store the last sent time in a 'gelfis_notifications' lightweight table
(created on first run). Prevents storm on repeated triggers.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Literal

from agents.shared.db import get_conn, get_config
from agents.shared.phone import normalize_phone
from agents.shared.rate_limits import BERLIN
from agents.whatsapp_service import WhatsAppError, WhatsAppService

log = logging.getLogger("notifications")


NotificationKind = Literal[
    "needs_human",
    "trial_30min",
    "reviewer_rejected_twice",
    "send_failed",
    "daily_summary",
]

_SUPPRESSION_WINDOWS: dict[NotificationKind, timedelta] = {
    "needs_human":             timedelta(hours=6),
    "trial_30min":             timedelta(hours=2),
    "reviewer_rejected_twice": timedelta(hours=24),
    "send_failed":             timedelta(hours=6),
    "daily_summary":           timedelta(hours=12),
}


def _ensure_table() -> None:
    """Create notifications table on first use (idempotent)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gelfis_notifications (
                id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                kind          TEXT NOT NULL,
                lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
                body          TEXT NOT NULL,
                success       BOOLEAN NOT NULL DEFAULT TRUE
            );
            CREATE INDEX IF NOT EXISTS idx_gelfis_notif_kind_lead
                ON gelfis_notifications(kind, lead_id, sent_at DESC);
        """)


def _gelfis_number() -> str | None:
    raw = os.environ.get("GELFIS_PERSONAL_WHATSAPP", "").strip()
    if not raw or raw.startswith("+49XXX"):
        return None
    try:
        return normalize_phone(raw)
    except ValueError:
        return None


def _recently_sent(kind: NotificationKind, lead_id: str | None) -> bool:
    window = _SUPPRESSION_WINDOWS[kind]
    cutoff = datetime.utcnow() - window
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
              FROM gelfis_notifications
             WHERE kind = %s
               AND sent_at >= %s
               AND (lead_id = %s OR (lead_id IS NULL AND %s IS NULL))
             LIMIT 1
            """,
            (kind, cutoff, lead_id, lead_id),
        )
        return cur.fetchone() is not None


def _record(kind: NotificationKind, lead_id: str | None, body: str, success: bool) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO gelfis_notifications (kind, lead_id, body, success)
            VALUES (%s, %s, %s, %s)
            """,
            (kind, lead_id, body[:2000], success),
        )


def _send(
    kind: NotificationKind,
    body: str,
    *,
    lead_id: str | None = None,
) -> bool:
    _ensure_table()

    number = _gelfis_number()
    if not number:
        log.warning("GELFIS_PERSONAL_WHATSAPP not set — skipping %s", kind)
        return False

    if _recently_sent(kind, lead_id):
        log.info("Suppressed duplicate %s notification (lead=%s)", kind, lead_id)
        return False

    try:
        wa = WhatsAppService()
        instance = get_config("active_whatsapp_instance") or "aprender-aleman-main"
        wa.send_text(instance, number, body)
        _record(kind, lead_id, body, success=True)
        return True
    except WhatsAppError as e:
        log.error("Failed to notify Gelfis (%s): %s", kind, e)
        _record(kind, lead_id, body, success=False)
        return False


# ──────────────────────────────────────────────────────────
# Public entry points — called from agents and dashboard
# ──────────────────────────────────────────────────────────


def _dash_link(lead_id: str) -> str:
    base = os.environ.get("PUBLIC_SITE_URL", "").rstrip("/")
    return f"{base}/admin/leads/{lead_id}" if base else f"/admin/leads/{lead_id}"


def notify_needs_human(lead: dict) -> bool:
    name = lead.get("name") or "(sin nombre)"
    body = (
        f"🚨 Lead pide hablar contigo\n"
        f"{name} — {lead.get('whatsapp_normalized')}\n"
        f"Meta: {lead.get('goal')} · Urgencia: {lead.get('urgency')}\n"
        f"→ {_dash_link(lead['id'])}"
    )
    return _send("needs_human", body, lead_id=lead["id"])


def notify_trial_30min(lead: dict) -> bool:
    name = lead.get("name") or "(sin nombre)"
    when = lead.get("trial_scheduled_at")
    when_str = when.astimezone(BERLIN).strftime("%H:%M") if isinstance(when, datetime) else "pronto"
    body = (
        f"⏰ Clase de prueba en 30 minutos\n"
        f"{name} — {lead.get('whatsapp_normalized')} — {when_str}\n"
        f"{lead.get('trial_zoom_link') or ''}\n"
        f"→ {_dash_link(lead['id'])}"
    )
    return _send("trial_30min", body, lead_id=lead["id"])


def notify_reviewer_rejected_twice(lead: dict, reason: str) -> bool:
    name = lead.get("name") or "(sin nombre)"
    body = (
        f"⚠️ Revisor IA rechazó dos borradores\n"
        f"{name} — {lead.get('whatsapp_normalized')}\n"
        f"Motivo: {reason[:200]}\n"
        f"→ {_dash_link(lead['id'])}"
    )
    return _send("reviewer_rejected_twice", body, lead_id=lead["id"])


def notify_send_failed(lead: dict, error: str) -> bool:
    name = lead.get("name") or "(sin nombre)"
    body = (
        f"❌ Fallo al enviar WhatsApp\n"
        f"{name} — {lead.get('whatsapp_normalized')}\n"
        f"Error: {error[:240]}\n"
        f"→ {_dash_link(lead['id'])}"
    )
    return _send("send_failed", body, lead_id=lead["id"])


def notify_daily_summary() -> bool:
    """Build and send the 19:00 daily summary."""
    today = datetime.now(BERLIN).replace(hour=0, minute=0, second=0, microsecond=0)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT
              (SELECT COUNT(*) FROM leads WHERE created_at >= %s)                        AS new_today,
              (SELECT COUNT(*) FROM leads WHERE status IN ('in_conversation','link_sent')) AS active,
              (SELECT COUNT(*) FROM leads WHERE status = 'needs_human')                  AS waiting,
              (SELECT COUNT(*) FROM leads WHERE status = 'converted'
                                            AND updated_at >= NOW() - INTERVAL '7 days') AS conv_week,
              (SELECT COUNT(*) FROM leads WHERE status = 'trial_scheduled'
                                            AND trial_scheduled_at >= NOW()
                                            AND trial_scheduled_at < NOW() + INTERVAL '1 day') AS trials_tomorrow
        """, (today,))
        row = cur.fetchone() or {}

    body = (
        f"📊 Resumen del día\n"
        f"Nuevos leads hoy: {row.get('new_today', 0)}\n"
        f"En conversación: {row.get('active', 0)}\n"
        f"Esperándote (humano): {row.get('waiting', 0)}\n"
        f"Conversiones 7d: {row.get('conv_week', 0)}\n"
        f"Clases mañana: {row.get('trials_tomorrow', 0)}\n"
        f"→ {_dash_link('') or os.environ.get('PUBLIC_SITE_URL', '') + '/admin'}"
    )
    return _send("daily_summary", body)


def scan_escalations_and_notify() -> int:
    """
    Sweep the recent timeline for entries that flagged alert_gelfis=true
    in metadata and haven't been notified yet. Called every 5 min.
    Returns the number of notifications sent.
    """
    _ensure_table()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT t.lead_id, t.content, t.metadata, t.timestamp,
                   l.name, l.whatsapp_normalized, l.goal, l.urgency
              FROM lead_timeline t
              JOIN leads l ON l.id = t.lead_id
             WHERE t.type = 'escalation'
               AND t.timestamp >= NOW() - INTERVAL '30 minutes'
               AND (t.metadata->>'alert_gelfis') = 'true'
             ORDER BY t.timestamp DESC
        """)
        rows = list(cur.fetchall())

    sent = 0
    for r in rows:
        lead = {
            "id":                  r["lead_id"],
            "name":                r["name"],
            "whatsapp_normalized": r["whatsapp_normalized"],
            "goal":                r["goal"],
            "urgency":             r["urgency"],
        }
        # Choose kind based on content.
        c = (r["content"] or "").lower()
        if "rejected" in c and "twice" in c:
            if notify_reviewer_rejected_twice(lead, r["content"]):
                sent += 1
        elif "send" in c and ("fail" in c or "error" in c):
            if notify_send_failed(lead, r["content"]):
                sent += 1
        else:
            if notify_needs_human(lead):
                sent += 1
    return sent
