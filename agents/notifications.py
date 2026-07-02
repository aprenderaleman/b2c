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
    # Reliability watchdogs (Phase 1 plan 2026-04-30)
    "silent_inbound",
    "unmatched_lid",
    "evolution_down",
    "trial_attended_pending",
    "synthetic_test_failed",
]

_SUPPRESSION_WINDOWS: dict[NotificationKind, timedelta] = {
    "needs_human":             timedelta(hours=6),
    "trial_30min":             timedelta(hours=2),
    "reviewer_rejected_twice": timedelta(hours=24),
    "send_failed":             timedelta(hours=6),
    "daily_summary":           timedelta(hours=12),
    "silent_inbound":          timedelta(hours=2),     # 1 ping cada 2h por lead
    "unmatched_lid":           timedelta(hours=6),
    "evolution_down":          timedelta(minutes=30),  # alerta cada 30m mientras dure
    "trial_attended_pending":  timedelta(hours=12),    # caso Sara: avisar 1×/12h
    "synthetic_test_failed":   timedelta(hours=2),
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


# Números que NUNCA deben recibir notificaciones automáticas.
# Caso 2026-05-30: Gelfis pidió cortar TODO el flujo a +491607530948
# (estaba recibiendo daily-digest, send-fail, silent-inbound, etc).
# Comparado por dígitos solamente (ignora +, espacios, etc).
_BLOCKLIST_DIGITS_HARDCODED = frozenset({
    "491607530948",
})


def _blocklist_digits() -> frozenset[str]:
    """
    Devuelve el set de dígitos bloqueados, fusionando la lista
    hardcoded con la columna `system_config.whatsapp_blocklist_phones`
    (CSV). Esto permite añadir números nuevos desde la BD SIN redeploy
    — útil cuando hay una emergencia y no se puede esperar al cron.
    """
    extra: set[str] = set()
    try:
        raw = get_config("whatsapp_blocklist_phones") or ""
        for piece in raw.split(","):
            digits = "".join(c for c in piece if c.isdigit())
            if digits:
                extra.add(digits)
    except Exception:
        # get_config puede fallar si la tabla no existe en el momento
        # del import. Caemos a la lista hardcoded sin romper.
        pass
    return _BLOCKLIST_DIGITS_HARDCODED | frozenset(extra)


def _is_blocklisted(number_e164: str | None) -> bool:
    if not number_e164:
        return False
    digits = "".join(c for c in number_e164 if c.isdigit())
    return digits in _blocklist_digits()


def _killswitch_active() -> bool:
    """
    Killswitch global de notificaciones a Gelfis. Si
    `system_config.gelfis_notifications_killswitch = 'on'` entonces
    NINGUNA función notify_* manda nada. Flippable desde la BD.
    """
    try:
        return (get_config("gelfis_notifications_killswitch") or "").lower() == "on"
    except Exception:
        return False


def _gelfis_number() -> str | None:
    raw = os.environ.get("GELFIS_PERSONAL_WHATSAPP", "").strip()
    if not raw or raw.startswith("+49XXX"):
        return None
    try:
        normalized = normalize_phone(raw)
    except ValueError:
        return None
    # Si el env apunta a un número bloqueado, NO devolvemos nada — así
    # ninguna notificación de este módulo intenta siquiera enviarse.
    if _is_blocklisted(normalized):
        log.warning(
            "GELFIS_PERSONAL_WHATSAPP=%s está en blocklist — todas las "
            "notificaciones a ese número quedan suprimidas.", normalized,
        )
        return None
    return normalized


def _recently_sent(kind: NotificationKind, lead_id: str | None) -> bool:
    window = _SUPPRESSION_WINDOWS[kind]
    cutoff = datetime.utcnow() - window
    # Cast explícito a UUID para evitar IndeterminateDatatype cuando
    # lead_id es None (psycopg v3 no infiere tipo de None en disjunción).
    with get_conn() as conn, conn.cursor() as cur:
        if lead_id is None:
            cur.execute(
                """
                SELECT 1 FROM gelfis_notifications
                 WHERE kind = %s AND sent_at >= %s AND lead_id IS NULL
                 LIMIT 1
                """,
                (kind, cutoff),
            )
        else:
            cur.execute(
                """
                SELECT 1 FROM gelfis_notifications
                 WHERE kind = %s AND sent_at >= %s AND lead_id = %s
                 LIMIT 1
                """,
                (kind, cutoff, lead_id),
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

    # Killswitch global desde system_config — flippable sin redeploy.
    if _killswitch_active():
        log.warning("gelfis_notifications_killswitch=on — skipping %s", kind)
        return False

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
                                            AND trial_scheduled_at < NOW() + INTERVAL '1 day') AS trials_tomorrow,
              (SELECT COUNT(*) FROM lead_timeline
                WHERE type='lead_message_received' AND timestamp >= %s)                  AS inbounds_today,
              (SELECT COUNT(*) FROM lead_timeline
                WHERE type='system_message_sent' AND timestamp >= %s)                    AS outbounds_today,
              (SELECT COUNT(*) FROM lead_timeline
                WHERE type='send_failed' AND timestamp >= %s)                            AS send_failed_today,
              count_silent_inbounds()                                                     AS silent_now
        """, (today, today, today, today))
        row = cur.fetchone() or {}

        # Tablas Phase 1+2 (no romper si aún no existen)
        try:
            cur.execute("""
                SELECT
                  COUNT(*) FILTER (WHERE resolved_at IS NULL
                                  AND received_at >= %s)                                 AS unmatched_today,
                  COUNT(*) FILTER (WHERE resolved_at IS NULL)                             AS unmatched_unresolved
                  FROM unmatched_inbounds
            """, (today,))
            unm = cur.fetchone() or {}
        except Exception:                                  # noqa: BLE001
            unm = {"unmatched_today": 0, "unmatched_unresolved": 0}

        try:
            cur.execute("""
                SELECT
                  COUNT(*) FILTER (WHERE status='pending')                                AS q_pending,
                  COUNT(*) FILTER (WHERE status='failed_permanent')                       AS q_failed
                  FROM inbound_processing_queue
            """)
            q = cur.fetchone() or {}
        except Exception:                                  # noqa: BLE001
            q = {"q_pending": 0, "q_failed": 0}

    health = "🟢" if (
        (row.get("silent_now") or 0) == 0
        and (unm.get("unmatched_unresolved") or 0) == 0
        and (q.get("q_failed") or 0) == 0
        and (row.get("send_failed_today") or 0) == 0
    ) else "🟡"

    body = (
        f"📊 Resumen del día {health}\n"
        f"Nuevos leads hoy: {row.get('new_today', 0)}\n"
        f"En conversación: {row.get('active', 0)}\n"
        f"Esperándote (humano): {row.get('waiting', 0)}\n"
        f"Conversiones 7d: {row.get('conv_week', 0)}\n"
        f"Clases mañana: {row.get('trials_tomorrow', 0)}\n"
        f"\n📨 Mensajería\n"
        f"Inbounds: {row.get('inbounds_today', 0)} · Outbounds: {row.get('outbounds_today', 0)}\n"
        f"Fallos envío: {row.get('send_failed_today', 0)}\n"
        f"\n🛡 Watchdogs\n"
        f"Inbounds silenciosos AHORA: {row.get('silent_now', 0)}\n"
        f"LIDs sin asociar (24h): {unm.get('unmatched_today', 0)} · acumulados: {unm.get('unmatched_unresolved', 0)}\n"
        f"Cola inbound: {q.get('q_pending', 0)} pendientes · {q.get('q_failed', 0)} fallos perm.\n"
        f"\n→ {_dash_link('') or os.environ.get('PUBLIC_SITE_URL', '') + '/admin'}"
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


# =============================================================================
# RELIABILITY WATCHDOGS (Phase 1 plan, 2026-04-30)
# =============================================================================
#
# Estos jobs corren en el scheduler y detectan/escalan los modos de falla
# que no se autodetectan por las escalaciones normales:
#
#   scan_silent_inbounds_and_alert  →  inbound del lead sin respuesta del bot
#   scan_unmatched_lids_and_alert   →  LIDs nuevos que no resolvimos
#   scan_evolution_health_and_alert →  sesión WhatsApp caída por X minutos
#
# Cada uno usa _send() con su NotificationKind y suppression window.
# =============================================================================


def scan_silent_inbounds_and_alert() -> int:
    """
    Detecta leads que escribieron en última 1h pero el bot NO respondió en
    los siguientes 15 min, y avisa a Gelfis. Cubre el escenario 'Christian:
    el inbound se loggeó pero handle_incoming_message falló silenciosamente'.

    Filtros:
      - status NOT IN (lost, converted, needs_human, cold)
        → cold leads ya no nos interesan; needs_human ya tiene su propio ping
      - ai_paused_until pasado o NULL
      - El último lead_message_received del lead es >15min y <60min
      - No hay system_message_sent / status_change / escalation DESPUÉS

    Devuelve cantidad de notificaciones enviadas (después de suppression).
    """
    _ensure_table()
    sent = 0
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            WITH last_inbound AS (
                SELECT lt.lead_id, MAX(lt.timestamp) AS last_at
                  FROM lead_timeline lt
                 WHERE lt.type = 'lead_message_received'
                   AND lt.timestamp > NOW() - INTERVAL '1 hour'
                   AND lt.timestamp < NOW() - INTERVAL '15 minutes'
                 GROUP BY lt.lead_id
            )
            SELECT li.lead_id, li.last_at,
                   l.name, l.whatsapp_normalized, l.status, l.goal, l.urgency,
                   (SELECT lt2.content FROM lead_timeline lt2
                     WHERE lt2.lead_id = li.lead_id AND lt2.type='lead_message_received'
                     ORDER BY lt2.timestamp DESC LIMIT 1) AS last_msg
              FROM last_inbound li
              JOIN leads l ON l.id = li.lead_id
             WHERE l.status NOT IN ('lost','converted','needs_human','cold')
               AND (l.ai_paused_until IS NULL OR l.ai_paused_until <= NOW())
               AND NOT EXISTS (
                   SELECT 1 FROM lead_timeline lt3
                    WHERE lt3.lead_id = li.lead_id
                      AND lt3.timestamp > li.last_at
                      AND lt3.type IN ('system_message_sent','status_change','escalation')
               )
            """
        )
        rows = list(cur.fetchall())

    for r in rows:
        body = (
            f"🔇 Lead escribió y nadie respondió\n"
            f"{r['name']} — {r['whatsapp_normalized']}\n"
            f"Status: {r['status']} · Hace {_minutes_since(r['last_at'])} min\n"
            f"Mensaje: \"{(r['last_msg'] or '')[:120]}\"\n"
            f"→ {_dash_link(r['lead_id'])}"
        )
        if _send("silent_inbound", body, lead_id=r["lead_id"]):
            sent += 1
    if sent:
        log.info("[silent_inbound_watchdog] alerted Gelfis on %d lead(s)", sent)
    return sent


def scan_unmatched_lids_and_alert() -> int:
    """
    Si _resolve_lead_for_lid devolvió None y registró el caso en
    unmatched_inbounds, alertar a Gelfis con los candidatos de outbound
    reciente para que pueda mapearlo manualmente desde /admin.
    """
    _ensure_table()
    sent = 0
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, jid, push_name, content_preview, received_at, candidates
                  FROM unmatched_inbounds
                 WHERE resolved_at IS NULL
                   AND received_at > NOW() - INTERVAL '24 hours'
                   AND received_at < NOW() - INTERVAL '5 minutes'
                """
            )
            rows = list(cur.fetchall())
    except Exception as e:                              # noqa: BLE001
        # Tabla no existe aún (primer arranque) — no es crítico
        log.info("unmatched_inbounds table not ready: %s", e)
        return 0

    for r in rows:
        body = (
            f"❓ Inbound sin matchear lead\n"
            f"JID: {r['jid']} · push: \"{r['push_name'] or '—'}\"\n"
            f"Hace {_minutes_since(r['received_at'])} min\n"
            f"Mensaje: \"{(r['content_preview'] or '')[:80]}\"\n"
            f"Candidatos: {r['candidates'] or '(ninguno)'}\n"
            f"→ /admin/leads (revisar manualmente)"
        )
        if _send("unmatched_lid", body, lead_id=None):
            sent += 1
    if sent:
        log.info("[unmatched_lid_watchdog] alerted Gelfis on %d unmatched(s)", sent)
    return sent


def scan_evolution_health_and_alert() -> int:
    """
    Si la sesión de Evolution está close/connecting/unknown por más de 5 min,
    alertar Gelfis para que reescanee el QR (o mire los logs).
    """
    _ensure_table()
    # Fuente de verdad: system_config.active_whatsapp_instance. Antes
    # solo mirábamos el env var, que quedaba desincronizado cada vez
    # que rotábamos la instancia por SQL (2026-07-02 v2 → v4).
    from agents.shared.db import get_config
    instance = (
        get_config("active_whatsapp_instance")
        or os.environ.get("EVOLUTION_INSTANCE_MAIN")
        or "aprender-aleman-main"
    )
    try:
        wa = WhatsAppService()
        state = wa.get_connection_state(instance)
    except Exception as e:                              # noqa: BLE001
        state = "unknown"
        log.warning("[evolution_health] couldn't fetch state: %s", e)

    if state == "open":
        return 0

    body = (
        f"📵 Evolution session NO está conectada\n"
        f"Estado actual: {state}\n"
        f"Instance: {instance}\n"
        f"→ /admin/system → revisa QR si hace falta"
    )
    return 1 if _send("evolution_down", body, lead_id=None) else 0


def notify_trial_attended_pending(lead: dict) -> bool:
    """
    Caso Sara 2026-04-30: lead asistió al trial, status=trial_attended,
    Gelfis tiene que decidir si convertir o lost. El bot NO debe auto-
    mensajear estos leads. Aviso una vez cuando entran a este estado.
    """
    name = lead.get("name") or "(sin nombre)"
    body = (
        f"✋ Decisión pendiente sobre lead\n"
        f"{name} — {lead.get('whatsapp_normalized')}\n"
        f"Asistió al trial. ¿Convertir o lost?\n"
        f"→ {_dash_link(lead['id'])}"
    )
    return _send("trial_attended_pending", body, lead_id=lead["id"])


def notify_synthetic_test_failed(reason: str) -> bool:
    """
    Cron diario sintético detectó un fallo en el flujo end-to-end.
    Esto es CRÍTICO — significa que el sistema no está procesando bien.
    """
    body = (
        f"🚨 Test sintético FALLÓ\n"
        f"Razón: {reason[:300]}\n"
        f"→ /admin/system para diagnosticar"
    )
    return _send("synthetic_test_failed", body, lead_id=None)


def _minutes_since(dt: datetime) -> int:
    if dt is None:
        return 0
    if dt.tzinfo is None:
        from datetime import timezone
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(dt.tzinfo) - dt
    return max(0, int(delta.total_seconds() / 60))
