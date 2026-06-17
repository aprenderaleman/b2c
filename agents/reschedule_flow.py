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
    r"alli\s+estare|allí\s+estaré|ahi\s+estare|ahí\s+estaré|"
    r"ahi\s+te\s+veo|ahí\s+te\s+veo|"
    r"voy\s+a\s+(ir|asistir|estar)|"
    r"si\s+(voy|asisto|estare|estaré)|"
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


# ─────────────────────────────────────────────────────────
# Templates breves (estilo Gelfis 2026-05-10)
# ─────────────────────────────────────────────────────────

def _msg_reschedule(language: str, name: str) -> str:
    if language == "de":
        return (
            f"Hallo {name}! 👋\n\n"
            "Kein Problem mit der Verschiebung. Buch dir einen neuen Termin "
            f"hier: {_REBOOK_URL}\n\n"
            "Sag mir Bescheid, wenn du gebucht hast.\n\n"
            "— Stiv · Aprender-Aleman.de"
        )
    return (
        f"¡Hola {name}! 👋\n\n"
        "Sin problema con el cambio. Puedes elegir un nuevo horario "
        f"aquí: {_REBOOK_URL}\n\n"
        "Avísame cuando hayas reagendado.\n\n"
        "— Stiv · Aprender-Aleman.de"
    )


def _msg_cancel(language: str, name: str) -> str:
    if language == "de":
        return (
            f"Hallo {name}! 👋\n\n"
            "Möchtest du deine Probestunde komplett ABSAGEN, oder lieber "
            "auf einen anderen Tag VERSCHIEBEN?\n\n"
            f"Wenn du verschieben willst, kannst du hier einen neuen "
            f"Termin wählen: {_REBOOK_URL}\n\n"
            "Sag mir Bescheid, wenn du gebucht hast.\n\n"
            "— Stiv · Aprender-Aleman.de"
        )
    return (
        f"¡Hola {name}! 👋\n\n"
        "¿Quieres CANCELAR tu clase de prueba, o prefieres MOVERLA a otro día/hora?\n\n"
        "Si prefieres reagendar, puedes hacerlo con este enlace en el horario "
        f"que prefieras: {_REBOOK_URL}\n\n"
        "Avísame cuando hayas reagendado por favor.\n\n"
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
    """Guarda timestamp de confirmacion en leads.meta.trial_confirmed_at
    para tracking interno. Reuso del patron de awaiting_payment_..."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT meta FROM leads WHERE id = %s", (lead_id,))
        row = cur.fetchone()
    existing = (row[0] if row and row[0] else {}) or {}
    if not isinstance(existing, dict):
        existing = {}
    existing["trial_confirmed_at"] = datetime.utcnow().isoformat() + "Z"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE leads SET meta = %s WHERE id = %s",
            (json.dumps(existing), lead_id),
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

    if state is not None:
        # Ya enviamos el link. Si el lead dice "ya reagendé" / "gracias"
        # / etc., agent_4 lo manejará. No volvemos a saturar con el link.
        return False

    is_confirm = detect_confirm_intent(text)
    is_reschedule = detect_reschedule_intent(text)
    is_cancel = detect_cancel_intent(text)
    if not is_confirm and not is_reschedule and not is_cancel:
        return False

    trial = _get_active_trial(lead_id)
    if not trial:
        # No hay trial pendiente → no es nuestra responsabilidad.
        return False

    if is_confirm:
        return _send_confirm_ack(lead, trial)
    return _send_link(lead, trial, intent="cancel" if is_cancel else "reschedule")


# ─────────────────────────────────────────────────────────
# Acciones
# ─────────────────────────────────────────────────────────

def _send_confirm_ack(lead: dict, trial: dict) -> bool:
    """Lead respondió CONFIRMO al trial confirmation. Mandamos ack breve,
    marcamos confirmed_at en leads.meta y avisamos al timeline. Gelfis
    2026-06-17."""
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")

    text = _msg_confirm_ack(lang, name)
    res = send_approved(lead, text, advance_followup=False)
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

    res = send_approved(lead, text, advance_followup=False)
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
