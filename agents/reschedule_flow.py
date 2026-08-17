"""
Reschedule / cancel flow — single-shot, self-serve.

Decisión Gelfis 2026-05-10 (refactor del 2026-05-04): el bot ya NO
intenta extraer fecha/hora ni proponer alternativas. Cuando un lead con
`trial_scheduled` pide cambiar o cancelar su clase, el bot manda UN
mensaje breve con el link `/agendar/cuando` para que el lead reagende
solo. Si en 24h no ha rebookeado, un cron envía un follow-up
"quedan pocos slots".

Por qué cambió:
  - El extractor LLM añadía 2-3 turnos al flujo y a veces alucinaba.
  - Cuando había problemas técnicos para acceder al calendario, el bot
    parecía obtuso pidiendo "¿qué día?" en vez de dejar al lead
    re-elegir tranquilo.
  - El picker self-serve es la misma UI del funnel inicial — el lead
    ya la conoce.

Estados que usamos en `leads.reschedule_state`:
  {
    phase: "AWAITING_REBOOK_RESCHEDULE" | "AWAITING_REBOOK_CANCEL" | "DONE",
    class_id: "uuid",
    original_scheduled_at: ISO,
    link_sent_at: ISO,
    followup_sent_at: ISO | null,    -- el cron 24h marca esto
    started_at: ISO
  }

Triggered por agent_4_conversation BEFORE su flujo normal — si
handle_inbound devuelve True, agent_4 sale sin generar nada más.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

from agents.agent_3_sender import send_approved
from agents.shared.db import get_conn
from agents.shared.leads import log_timeline

log = logging.getLogger("reschedule_flow")


# ─────────────────────────────────────────────────────────
# Configuración
# ─────────────────────────────────────────────────────────

_PLATFORM_URL = os.environ.get("PLATFORM_URL", "https://b2c.aprender-aleman.de").rstrip("/")
_REBOOK_URL = f"{_PLATFORM_URL}/agendar/cuando"


# ─────────────────────────────────────────────────────────
# Detección de intent
# ─────────────────────────────────────────────────────────

# Reschedule = quiero cambiar a otro horario
_RESCHEDULE_RE = re.compile(
    r"\b(cambiar|cambio|reagendar|aplazar|posponer|mover|mueve|"
    r"otra\s*(hora|día|fecha)|otro\s*(día|horario)|"
    r"no\s+puedo\s+(a\s+)?esa|no\s+me\s+viene\s+bien|"
    r"verschieben|umbuchen|ändern|anderer\s+termin)\b",
    re.IGNORECASE,
)

# Cancel = quiero cancelar (sin necesariamente mover)
_CANCEL_RE = re.compile(
    r"\b(cancelar|cancela|cancel|cancelo|"
    r"no\s+podré|no\s+podre|no\s+voy\s+a\s+poder|"
    r"absagen|stornieren)\b",
    re.IGNORECASE,
)

# Confirm = confirma asistencia a la clase de prueba (Gelfis 2026-06-17).
# El copy de book-trial pide explicitamente "CONFIRMO". Detectamos esa
# palabra exacta y variantes naturales ("confirmo", "confirmado",
# "confirmar", "voy", "alli estare", "ahi estare", "ahi te veo", etc.).
# Para evitar falsos positivos con "no confirmo" o "no voy", chequeamos
# que no haya negacion delante.
_CONFIRM_RE = re.compile(
    r"\b(confirmo|confirmado|confirmada|confirmar|confirmacion|confirmación|"
    # Typos comunes observados en producción (Ángela 2026-07-10: "CONFINMO"):
    r"confinmo|confimo|confrimo|confrimo|comfirmo|comfimo|"
    r"alli\s+estare|allí\s+estaré|ahi\s+estare|ahí\s+estaré|"
    r"ahi\s+te\s+veo|ahí\s+te\s+veo|"
    r"voy\s+a\s+(ir|asistir|estar)|"
    r"s[ií]\s+(voy|asisto|estare|estaré)|"
    r"bestätigt|bestaetigt|bestätige|bestaetige)\b",
    re.IGNORECASE,
)
_NEGATION_BEFORE_CONFIRM_RE = re.compile(
    r"\b(no|nicht|nein|kein)\s+\w*\s*(confirmo|confirmado|voy|asisto|"
    r"estare|estaré|bestätig)",
    re.IGNORECASE,
)


def detect_reschedule_intent(text: str) -> bool:
    return bool(_RESCHEDULE_RE.search(text or ""))


def detect_cancel_intent(text: str) -> bool:
    return bool(_CANCEL_RE.search(text or ""))


def detect_confirm_intent(text: str) -> bool:
    t = text or ""
    if _NEGATION_BEFORE_CONFIRM_RE.search(t):
        return False
    return bool(_CONFIRM_RE.search(t))


# ─────────────────────────────────────────────────────────
# Absent-interest detectors (Gelfis 2026-07-16)
# Cuando el lead absent ha recibido el mensaje "¿sigues interesado?",
# examinamos su siguiente respuesta para determinar SÍ / NO / unclear.
# ─────────────────────────────────────────────────────────
_INTEREST_YES_RE = re.compile(
    r"\b(s[ií]|claro|dale|obvio|por\s+supuesto|quiero|"
    r"m[aá]ndamelo|env[ií]amelo|manda|env[ií]a|env[ií]al[ao]|"
    r"adelante|vamos|vale|ok|perfecto|genial|"
    r"ja|jawohl|nat[uü]rlich|klar|gerne)\b",
    re.IGNORECASE,
)
_INTEREST_NO_RE = re.compile(
    r"\b(no|nope|nunca|"
    r"ya\s+no|olvida|olvidalo|olvídalo|"
    r"no\s+me\s+interesa|no\s+gracias|"
    r"nein|kein\s+interesse)\b",
    re.IGNORECASE,
)


def detect_absent_interest(text: str) -> str:
    """Devuelve 'yes' | 'no' | 'unclear' para respuestas a la
    pregunta ¿sigues teniendo interés?"""
    t = (text or "").strip().lower()
    if not t:
        return "unclear"
    # NO tiene prioridad — "no me interesa" tiene 'no' Y 'sí'-like tokens
    if _INTEREST_NO_RE.search(t):
        return "no"
    if _INTEREST_YES_RE.search(t):
        return "yes"
    return "unclear"


# ─────────────────────────────────────────────────────────
# State
# ─────────────────────────────────────────────────────────

def _read_state(lead_id: str) -> dict | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT reschedule_state FROM leads WHERE id = %s", (lead_id,))
        row = cur.fetchone()
    raw = row[0] if row else None
    if not raw or raw.get("phase") == "DONE":
        return None
    return raw


def _write_state(lead_id: str, state: dict | None) -> None:
    payload = json.dumps(state) if state else None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE leads SET reschedule_state = %s WHERE id = %s",
            (payload, lead_id),
        )


def _get_active_sesion_plan(lead_id: str) -> dict | None:
    """Devuelve la Sesion de Plan-Alemán futura mas cercana del lead (funnel
    /sesion-plan con closer, no clase de prueba). Solo status='scheduled'
    y aun futura — si ya pasó, no la traemos: el rescate del no-show es
    tarea del closer, no de este flow.
    Devuelve dict con id, scheduled_at, closer_name (para el ACK)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.scheduled_at, u.full_name AS closer_name
              FROM classes c
              LEFT JOIN users u ON u.id = c.sesion_closer_id
             WHERE c.lead_id = %s
               AND c.sesion_closer_id IS NOT NULL
               AND c.status = 'scheduled'
               AND c.scheduled_at > NOW()
             ORDER BY c.scheduled_at ASC
             LIMIT 1
            """,
            (lead_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id":            row["id"],
        "scheduled_at":  row["scheduled_at"],
        "closer_name":   row["closer_name"],
    }


def _get_active_trial(lead_id: str) -> dict | None:
    """Devuelve la clase de prueba 'activa' del lead. Ampliado 2026-06-14
    (caso Nadyn): tambien matchea clases con status != 'scheduled' si
    quedan dentro de la ventana razonable para reagendar:
      - futuro (cualquier hora)
      - pasadas en las ultimas 6 horas (no llegue a tiempo pero quiero
        moverla a otro dia)
    Asi el lead que dice 'no podré' justo despues de la hora aun entra
    al flujo de reagendar self-serve en vez de caer al fallback."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, scheduled_at, teacher_id, duration_minutes, status
              FROM classes
             WHERE lead_id = %s
               AND is_trial = TRUE
               AND (
                 status = 'scheduled'
                 OR scheduled_at > NOW() - INTERVAL '6 hours'
               )
             ORDER BY scheduled_at DESC
             LIMIT 1
            """,
            (lead_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "scheduled_at": row[1].isoformat() if row[1] else None,
        "teacher_id": row[2],
        "duration_minutes": row[3],
    }


def _cancel_class_and_notify_teacher(class_id: str, lead_id: str, lead_first_name: str) -> None:
    """Auto-cancelación cuando el lead responde CANCELAR por WA.
    Marca la clase como cancelled + notifica al profesor in-app con
    un mensaje breve. NO envía email ni WA al profesor — solo campana.
    Gelfis 2026-07-09.

    Además hace rollback del status del lead a in_conversation si no
    tiene otra clase de prueba futura (mismo comportamiento que el
    endpoint /api/trial-classes/[id]/cancel del TS)."""
    with get_conn() as conn, conn.cursor() as cur:
        # 1. Traer datos de la clase antes de cancelarla
        cur.execute(
            """
            SELECT c.status, c.scheduled_at, c.teacher_id,
                   t.user_id AS teacher_user_id
              FROM classes c
              LEFT JOIN teachers t ON t.id = c.teacher_id
             WHERE c.id = %s
            """,
            (class_id,),
        )
        row = cur.fetchone()
        if not row:
            log.warning("[cancel] class %s not found", class_id)
            return
        current_status, scheduled_at, teacher_id, teacher_user_id = row
        if current_status == "cancelled":
            log.info("[cancel] class %s already cancelled — skipping", class_id)
            return

        # 2. Cancelar la clase
        cur.execute(
            "UPDATE classes SET status='cancelled', updated_at=NOW() WHERE id=%s",
            (class_id,),
        )

        # 3. Timeline: registro de la cancelación por lead
        try:
            when_txt = scheduled_at.strftime("%d/%m %H:%M") if scheduled_at else "?"
        except Exception:                                       # noqa: BLE001
            when_txt = "?"
        cur.execute(
            """
            INSERT INTO lead_timeline (lead_id, type, author, content, metadata)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            """,
            (
                lead_id,
                "status_change",
                "system",
                f"🚫 Lead canceló la clase por WhatsApp (era {when_txt} Berlín)",
                json.dumps({
                    "class_id": class_id,
                    "kind": "trial_cancelled_by_lead",
                    "cancelled_by_role": "lead",
                    "channel": "whatsapp",
                }),
            ),
        )

        # 4. Notificar al profesor in-app (campana). Solo si tenemos user_id.
        if teacher_user_id:
            title = f"{lead_first_name or 'El lead'} canceló su clase de prueba"
            body  = f"Era {when_txt} Berlín. Puedes retomar tu tiempo."
            cur.execute(
                """
                INSERT INTO notifications (user_id, type, title, body, link, class_id)
                VALUES (%s, 'class_cancelled', %s, %s, %s, %s)
                """,
                (
                    teacher_user_id,
                    title,
                    body,
                    "/profesor/clasedeprueba",
                    class_id,
                ),
            )

        # 5. Rollback status del lead si no queda otra trial futura
        cur.execute(
            """
            SELECT 1 FROM classes
             WHERE lead_id=%s AND is_trial=TRUE AND status='scheduled'
               AND scheduled_at > NOW() LIMIT 1
            """,
            (lead_id,),
        )
        has_other = cur.fetchone() is not None
        if not has_other:
            cur.execute(
                """
                UPDATE leads
                   SET trial_scheduled_at = NULL,
                       status = CASE
                         WHEN status IN ('trial_scheduled','trial_reminded')
                           THEN 'in_conversation'::lead_status
                         ELSE status
                       END
                 WHERE id = %s
                """,
                (lead_id,),
            )
        conn.commit()
    log.info("[cancel] class %s cancelled + teacher %s notified in-app", class_id, teacher_id)


# ─────────────────────────────────────────────────────────
# Templates breves (estilo Gelfis 2026-05-10)
# ─────────────────────────────────────────────────────────

def _msg_reschedule(language: str, name: str) -> str:
    """CAMBIAR y CANCELAR comparten el mismo copy desde 2026-07-04.
    Delegar a _msg_cancel evita divergencia entre los dos textos."""
    return _msg_cancel(language, name)


def _msg_cancel(language: str, name: str) -> str:
    """Respuesta cuando el lead dice CAMBIAR o CANCELAR (Gelfis 2026-07-04:
    ambos disparan la misma respuesta — llevamos al lead directo al
    reagenda self-serve sin preguntar de qué se trata; el que no
    quiera reagendar simplemente ignora)."""
    if language == "de":
        return (
            f"Hallo {name}! 👋\n\n"
            "Kein Problem, ich helfe dir. Du kannst hier in 3 Minuten "
            "einen neuen Termin auswählen:\n\n"
            f"👉 {_REBOOK_URL}\n\n"
            "Sag mir Bescheid, sobald du gebucht hast. 😊\n\n"
            "— Stiv · Aprender-Aleman.de"
        )
    return (
        f"¡Hola {name}! 👋\n\n"
        "Sin problema, te ayudo. Puedes elegir un nuevo horario aquí "
        "en 3 minutos:\n\n"
        f"👉 {_REBOOK_URL}\n\n"
        "Avísame cuando hayas reagendado. 😊\n\n"
        "— Stiv · Aprender-Aleman.de"
    )


def _msg_confirm_ack(language: str, name: str) -> str:
    """Ack breve cuando el lead dice CONFIRMO. Gelfis 2026-06-17."""
    if language == "de":
        return (
            f"Perfekt {name}! 🙌\n\n"
            "Ich freue mich auf unsere Stunde. Du bekommst kurz vorher "
            "noch einen Reminder mit dem Link.\n\n"
            "Bis bald!\n\n"
            "— Stiv · Aprender-Aleman.de"
        )
    return (
        f"¡Perfecto {name}! 🙌\n\n"
        "Cuento contigo. Te mando un recordatorio con el enlace antes "
        "de la clase.\n\n"
        "¡Nos vemos!\n\n"
        "— Stiv · Aprender-Aleman.de"
    )


def _persist_confirmation(lead_id: str) -> None:
    """Guarda timestamp de confirmacion en leads.trial_confirmed_at
    (migration 066, 2026-06-17). Consistente con trial_attended_at /
    trial_absent_at que ya existen para los otros estados post-trial."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE leads SET trial_confirmed_at = NOW() WHERE id = %s",
            (lead_id,),
        )


def _msg_followup_24h(language: str, name: str) -> str:
    """24h después de mandar el link y sin rebook → recordatorio."""
    if language == "de":
        return (
            f"Hallo {name}! 👋\n\n"
            "Ich sehe, du hast noch keinen neuen Termin gebucht. Es bleiben "
            "nur noch wenige Probestunden frei diese Woche — falls du Probleme "
            "beim Buchen hast, sag mir Bescheid und ich helfe dir.\n\n"
            f"Hier nochmal der Link: {_REBOOK_URL}\n\n"
            "— Stiv · Aprender-Aleman.de"
        )
    return (
        f"¡Hola {name}! 👋\n\n"
        "Veo que aún no has reagendado. Quedan pocos slots libres esta "
        "semana — si has tenido algún problema para agendar, dímelo y te "
        "echo una mano.\n\n"
        f"Aquí el enlace de nuevo: {_REBOOK_URL}\n\n"
        "— Stiv · Aprender-Aleman.de"
    )


# ─────────────────────────────────────────────────────────
# Entry points (llamados desde agent_4)
# ─────────────────────────────────────────────────────────

def is_in_flow(lead_id: str) -> bool:
    return _read_state(lead_id) is not None


def handle_inbound(lead: dict, text: str) -> bool:
    """
    Entrada principal. Devuelve True si el flow tomó control y agent_4
    NO debe hacer nada más para este mensaje.

    Caso A: lead YA recibió el link (phase=AWAITING_REBOOK_*) → no
            volvemos a enviar nada; dejamos que agent_4 conteste
            normalmente (ej. si el lead dice "ya reagendé"). El cron
            de followup 24h actuará si el lead no rebookea.

    Caso B: lead nuevo en este flujo → si detectamos intent reschedule
            o cancel Y el lead tiene un trial scheduled, mandamos el
            link y registramos state.

    Caso C: cualquier otro mensaje → False (agent_4 procesa).
    """
    lead_id = lead["id"]
    state = _read_state(lead_id)

    # Welcome week check-in (Gelfis 2026-08-14): el motor TS setea
    # phase=AWAITING_WELCOME_CHECKIN cuando envía el step 4 del
    # welcome_week (día 7 post-conversion). El lead responde "1", "2"
    # o "3" con la opción. Solo interpretamos EXACTO 1/2/3 — cualquier
    # otra respuesta cae a agent_4 normal (regla del sistema: nunca
    # interpretación semántica más allá del token exacto).
    if state and state.get("phase") == "AWAITING_WELCOME_CHECKIN":
        stripped = (text or "").strip()
        # Normalizar: puede venir "1️⃣" o "1" o "1." etc. Solo primer char dígito.
        first = stripped[0] if stripped else ""
        if first in ("1", "2", "3"):
            return _handle_welcome_checkin_response(lead, first)
        return False  # cualquier otra cosa → agent_4 la procesa

    # Absent-interest flow (Gelfis 2026-07-16): el lead no asistió y
    # le mandamos "¿sigues interesado?". Detectamos SÍ / NO en su
    # respuesta ANTES del resto de intents.
    if state and state.get("phase") == "AWAITING_ABSENT_INTEREST":
        answer = detect_absent_interest(text)
        if answer == "yes":
            return _handle_absent_interest_yes(lead)
        if answer == "no":
            return _handle_absent_interest_no(lead)
        # unclear → dejamos que agent_4 responda; el state se mantiene
        return False

    if state is not None:
        # Ya enviamos el link. Si el lead dice "ya reagendé" / "gracias"
        # / etc., agent_4 lo manejará. No volvemos a saturar con el link.
        return False

    is_confirm = detect_confirm_intent(text)
    is_reschedule = detect_reschedule_intent(text)
    is_cancel = detect_cancel_intent(text)
    if not is_confirm and not is_reschedule and not is_cancel:
        return False

    # Sesion de Plan-Alemán tiene prioridad sobre trial en el ACK CONFIRMO
    # (Gelfis 2026-08-14): si el lead tiene sesion futura, responder
    # CONFIRMO se refiere a la sesion. reschedule/cancel de sesion no
    # se manejan aqui — el closer las mueve manualmente desde su panel.
    if is_confirm:
        sesion = _get_active_sesion_plan(lead_id)
        if sesion:
            return _send_sesion_confirm_ack(lead, sesion)

    trial = _get_active_trial(lead_id)
    if not trial:
        # No hay trial pendiente → no es nuestra responsabilidad.
        return False

    if is_confirm:
        return _send_confirm_ack(lead, trial)
    return _send_link(lead, trial, intent="cancel" if is_cancel else "reschedule")


def _handle_welcome_checkin_response(lead: dict, choice: str) -> bool:
    """Lead respondió 1/2/3 al check-in de welcome_week (día 7).
    1 = ack de celebración + limpiar state.
    2 o 3 = needs_human + tarea al admin/profe con contexto.
    Gelfis 2026-08-14 — regla: nunca interpretación más allá del token exacto.
    """
    lead_id = lead["id"]
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")

    if choice == "1":
        # ACK: leer template welcome_week sub_n=5 desde BD
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    "SELECT body FROM message_templates WHERE kind='welcome_week' AND sub_n=5 AND channel='whatsapp' AND active=true"
                )
                row = cur.fetchone()
            body_tpl = (row["body"] if isinstance(row, dict) else row[0]) if row else None
            text = body_tpl.replace("{nombre}", name) if body_tpl else (
                f"¡Genial, {name}! 🎉 Sigue así — cualquier cosa, aquí estoy."
            )
            res = send_approved(lead, text, advance_followup=False, kind="welcome_week_checkin_ack")
            if not res.success:
                log.warning("[welcome-checkin] ack send failed for %s: %s", lead_id, res.reason)
        except Exception:  # noqa: BLE001
            log.exception("[welcome-checkin] failed to send ack")

        # Limpiar state
        _write_state(lead_id, None)
        log_timeline(
            lead_id, type="agent_note", author="system",
            content="✅ Welcome week check-in: respondió 1 (todo bien)",
            metadata={"kind": "welcome_week_checkin_answer", "choice": "1"},
        )
        return True

    # choice in ("2", "3") → needs_human + tarea al admin
    reasons = {
        "2": "duda pendiente (respuesta 2 al check-in semana 1)",
        "3": "necesita ayuda (respuesta 3 al check-in semana 1)",
    }
    reason = reasons.get(choice, "check-in semana 1")
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("UPDATE leads SET status='needs_human' WHERE id=%s", (lead_id,))
            # Crear tarea al admin/closer del lead (si existe)
            cur.execute(
                "SELECT closer_id FROM leads WHERE id=%s",
                (lead_id,),
            )
            row = cur.fetchone()
            closer_id = (row["closer_id"] if isinstance(row, dict) else row[0]) if row else None
            if closer_id:
                from datetime import datetime, timedelta, timezone
                now = datetime.now(timezone.utc)
                cur.execute(
                    """
                    INSERT INTO tareas_closer (closer_id, lead_id, paso, tipo, canal,
                        plantilla, fecha_programada, prioridad, fecha_vence)
                    VALUES (%s, %s, 1, 'welcome_checkin', 'whatsapp', %s, %s, 'alta', %s)
                    """,
                    (
                        closer_id, lead_id,
                        f"Check-in semana 1: {reason}. Responder al alumno hoy.",
                        now, now + timedelta(hours=24),
                    ),
                )
    except Exception:  # noqa: BLE001
        log.exception("[welcome-checkin] failed to mark needs_human / create tarea")

    _write_state(lead_id, None)
    log_timeline(
        lead_id, type="agent_note", author="system",
        content=f"⚠️ Welcome week check-in: respondió {choice} — {reason} → needs_human + tarea",
        metadata={"kind": "welcome_week_checkin_answer", "choice": choice},
    )
    return True


def _handle_absent_interest_yes(lead: dict) -> bool:
    """Lead absent respondió que SÍ tiene interés → mandamos link."""
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")
    platform = os.environ.get("PLATFORM_URL", "https://b2c.aprender-aleman.de").rstrip("/")
    url = f"{platform}/agendar/cuando?lead={lead['id']}&from=absent_interest_yes"
    text = (
        f"¡Genial {name}! 👋\n\n"
        "Aquí tienes el enlace para reagendar en 3 minutos:\n\n"
        f"👉 {url}\n\n"
        "Avísame cuando lo hayas hecho. 😊\n\n"
        "— Stiv · Aprender-Aleman.de"
    ) if lang != "de" else (
        f"Super {name}! 👋\n\n"
        "Hier ist der Link zum Umbuchen (dauert 3 Min):\n\n"
        f"👉 {url}\n\n"
        "Sag mir Bescheid, sobald du gebucht hast. 😊\n\n"
        "— Stiv · Aprender-Aleman.de"
    )
    res = send_approved(lead, text, advance_followup=False, kind="trial_absent_interest_yes")
    if not res.success:
        log.warning("[absent-interest-yes] send failed for %s: %s", lead["id"], res.reason)
        return True
    # Limpiar state — ya cumplió su rol
    _write_state(lead["id"], None)
    log_timeline(
        lead["id"],
        type="agent_note",
        author="system",
        content="✅ Lead absent confirmó interés → link enviado",
        metadata={"kind": "absent_interest_yes"},
    )
    return True


def _handle_absent_interest_no(lead: dict) -> bool:
    """Lead absent respondió NO → mandamos cierre + marcamos lost."""
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")
    text = (
        f"Entendido {name}. Si algún día cambias de opinión, aquí estamos. "
        "¡Éxito con lo que decidas! 🍀\n\n"
        "— Stiv · Aprender-Aleman.de"
    ) if lang != "de" else (
        f"Verstanden {name}. Falls du dich später umentscheidest, sind wir hier. "
        "Viel Erfolg mit allem! 🍀\n\n"
        "— Stiv · Aprender-Aleman.de"
    )
    res = send_approved(lead, text, advance_followup=False, kind="trial_absent_interest_close")
    if not res.success:
        log.warning("[absent-interest-no] send failed for %s: %s", lead["id"], res.reason)

    # Marcar lost + limpiar state (sin importar si el cierre WA falló)
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE leads SET status='lost'::lead_status, "
                "                 next_contact_date=NULL, "
                "                 reschedule_state=NULL "
                "WHERE id=%s",
                (lead["id"],),
            )
            conn.commit()
    except Exception:                                       # noqa: BLE001
        log.exception("[absent-interest-no] could not mark lost")

    log_timeline(
        lead["id"],
        type="status_change",
        author="system",
        content="🚫 Lead absent respondió 'no me interesa' → status=lost",
        metadata={"kind": "absent_interest_no", "channel": "whatsapp"},
    )
    return True


# ─────────────────────────────────────────────────────────
# Acciones
# ─────────────────────────────────────────────────────────

def _send_sesion_confirm_ack(lead: dict, sesion: dict) -> bool:
    """Lead respondió CONFIRMO a la Sesion de Plan-Alemán (funnel /sesion-plan).
    Copy Gelfis 2026-08-14: menciona al closer por nombre + fecha corta.
    Persiste badge de confirmacion en leads.meta.sesion_confirmed_at.
    """
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")
    closer_full = sesion.get("closer_name") or ""
    closer_first = closer_full.split()[0] if closer_full else ""

    # Fecha formateada en español, hora de Berlin
    sched = sesion["scheduled_at"]
    try:
        # Formato "sábado, 8 de agosto" (sin hora — el copy es informal)
        import zoneinfo
        berlin = sched.astimezone(zoneinfo.ZoneInfo("Europe/Berlin"))
        dias = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"]
        meses = ["enero","febrero","marzo","abril","mayo","junio",
                 "julio","agosto","septiembre","octubre","noviembre","diciembre"]
        fecha = f"{dias[berlin.weekday()]}, {berlin.day} de {meses[berlin.month-1]}"
    except Exception:
        fecha = "la fecha agendada"

    who = closer_first if closer_first else "Tu asesor"
    text = (
        f"¡Perfecto, {name}! {who} te espera el {fecha} 😊 "
        "Te recuerdo antes de la sesión."
    )

    res = send_approved(lead, text, advance_followup=False, kind="sesion_confirm_ack")
    if not res.success:
        log.warning("[sesion-confirm] ack send blocked/failed for %s: %s", lead["id"], res.reason)
        return True   # mantenemos control aunque el envio falle

    # Persistir badge en leads.meta.sesion_confirmed_at
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE leads
                   SET meta = COALESCE(meta, '{}'::jsonb)
                                || jsonb_build_object('sesion_confirmed_at', NOW()::text)
                 WHERE id = %s
                """,
                (lead["id"],),
            )
    except Exception:  # noqa: BLE001
        log.exception("[sesion-confirm] could not persist sesion_confirmed_at")

    log_timeline(
        lead["id"],
        type="agent_note",
        author="system",
        content=f"✅ Lead confirmó asistencia a Sesion de Plan-Alemán con {closer_first}",
        metadata={"class_id": sesion["id"], "kind": "sesion_confirmed"},
    )
    return True


def _send_confirm_ack(lead: dict, trial: dict) -> bool:
    """Lead respondió CONFIRMO al trial confirmation. Mandamos ack breve,
    marcamos confirmed_at en leads.meta y avisamos al timeline. Gelfis
    2026-06-17."""
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")

    text = _msg_confirm_ack(lang, name)
    # kind="trial_confirm_ack" — pasa el kill switch en modo "partial"
    # (whitelist). Sin esto el envío se silencia en modo restringido.
    res = send_approved(lead, text, advance_followup=False, kind="trial_confirm_ack")
    if not res.success:
        log.warning("[confirm] ack send blocked/failed for %s: %s", lead["id"], res.reason)
        return True   # mantenemos control (no caemos al flujo normal)

    try:
        _persist_confirmation(lead["id"])
    except Exception:                                       # noqa: BLE001
        log.exception("[confirm] could not persist trial_confirmed_at")

    log_timeline(
        lead["id"],
        type="agent_note",
        author="system",
        content="✅ Lead confirmó asistencia al trial",
        metadata={"class_id": trial["id"], "kind": "trial_confirmed"},
    )
    return True


def _send_link(lead: dict, trial: dict, *, intent: str) -> bool:
    """Envía el mensaje breve con el link self-serve y registra state."""
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")

    text = _msg_cancel(lang, name) if intent == "cancel" else _msg_reschedule(lang, name)

    # kind="trial_reschedule_link" — pasa el kill switch en modo "partial".
    res = send_approved(lead, text, advance_followup=False, kind="trial_reschedule_link")

    # Auto-cancelación cuando el intent es CANCELAR (Gelfis 2026-07-09):
    # marcamos la clase como cancelada + notificamos al profesor in-app
    # para que retome su tiempo. Para intent=reschedule esperamos 24h
    # (el cron reschedule-followup cierra la clase si no rebookean).
    if intent == "cancel":
        try:
            _cancel_class_and_notify_teacher(trial["id"], lead["id"], name)
        except Exception:                                       # noqa: BLE001
            log.exception("[cancel] failed to cancel class + notify teacher")
    if not res.success:
        log.warning("[reschedule] send blocked/failed for %s: %s", lead["id"], res.reason)
        return True   # no caemos al flujo normal aunque haya fallado el send

    now = datetime.now(timezone.utc).isoformat()
    state = {
        "phase": "AWAITING_REBOOK_CANCEL" if intent == "cancel" else "AWAITING_REBOOK_RESCHEDULE",
        "class_id": trial["id"],
        "original_scheduled_at": trial["scheduled_at"],
        "link_sent_at": now,
        "followup_sent_at": None,
        "started_at": now,
    }
    _write_state(lead["id"], state)
    log_timeline(
        lead["id"],
        type="agent_note",
        author="system",
        content=f"🔄 Link self-serve enviado ({intent}) — esperando rebook del lead",
        metadata={"class_id": trial["id"], "intent": intent, "kind": "reschedule_link_sent"},
    )
    return True


# ─────────────────────────────────────────────────────────
# Helper para el cron de followup 24h (llamado por web/scheduler)
# ─────────────────────────────────────────────────────────

def _format_24h_followup_text(lead: dict) -> str:
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")
    return _msg_followup_24h(lang, name)
