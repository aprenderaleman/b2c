"""
Reschedule flow — máquina de estados multi-turno para "cambio de hora del trial".

Decisión Gelfis 2026-05-04 tras incidente Asmaa:
  Cuando un lead con `trial_scheduled` escribe pidiendo cambiar el horario,
  el bot ya NO responde con plantilla genérica. Entra a este flujo:

    1. Detectar intent (keywords + LLM clasificador)
    2. Pedir nueva hora al lead
    3. Parsear fecha/hora de la respuesta (LLM extractor)
    4. Validar disponibilidad contra teacher_availability + classes
       (preferimos el profe original; si no, pool entero)
    5. Si hay → UPDATE atómico de la clase + Google Calendar event
    6. Si no → ofrecer hasta 3 alternativas cercanas e iterar
    7. ≥3 rechazos del lead → escalar a needs_human

Cada transición:
  - Pasa por pre_send_guard (dedup/burst — herramienta global)
  - Loguea en lead_timeline con type='agent_note' o 'system_message_sent'
  - Actualiza leads.reschedule_state JSONB para que sobreviva a reinicios

Arquitectura: este módulo es la lógica pura. agent_4_conversation.py es
quien lo llama cuando detecta que un mensaje entrante es de un lead con
trial_scheduled. Si reschedule_flow.handle_inbound() devuelve True, el
agent_4 NO genera ni envía nada más para ese mensaje.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urlparse

import requests

from agents.agent_3_sender import send_approved
from agents.shared.claude_client import MODEL_HAIKU, complete_json
from agents.shared.db import get_conn
from agents.shared.leads import log_timeline, update_status

log = logging.getLogger("reschedule_flow")


# ─────────────────────────────────────────────────────────
# Configuración
# ─────────────────────────────────────────────────────────

# Endpoint del web (Vercel) — ya hay envs para hablar con él en los
# otros flujos; reusamos.
_PLATFORM_URL = os.environ.get("PLATFORM_URL", "https://b2c.aprender-aleman.de").rstrip("/")
_INTERNAL_KEY = os.environ.get("B2C_INTERNAL_API_KEY", "")
_TIMEOUT = 20

MAX_REJECTIONS_BEFORE_ESCALATE = 3
TRIAL_DURATION_MIN = 45


# ─────────────────────────────────────────────────────────
# Detección de intent
# ─────────────────────────────────────────────────────────

# Heurística rápida — si dispara, no llamamos a LLM (ahorra latencia).
_RESCHEDULE_KEYWORDS = (
    r"\b(cambiar|cambio|reagendar|aplazar|posponer|mover|mueve|"
    r"otra\s*(hora|día|fecha)|otro\s*(día|horario)|"
    r"no\s+puedo\s+(a\s+)?esa|no\s+me\s+viene\s+bien|"
    r"verschieben|umbuchen|ändern|anderer\s+termin)\b"
)
_RESCHEDULE_RE = re.compile(_RESCHEDULE_KEYWORDS, re.IGNORECASE)


def detect_reschedule_intent(text: str) -> bool:
    """True si el texto suena a "quiero cambiar mi clase de prueba"."""
    return bool(_RESCHEDULE_RE.search(text or ""))


# ─────────────────────────────────────────────────────────
# State machine
# ─────────────────────────────────────────────────────────

Phase = Literal["AWAITING_TIME", "CONFIRMING", "DONE"]


@dataclass
class State:
    phase:                Phase
    class_id:             str
    original_scheduled_at: str
    proposed_at:          str | None = None
    alternatives_offered: list[str] | None = None
    rejected_count:       int = 0
    started_at:           str = ""
    updated_at:           str = ""

    def to_jsonb(self) -> dict[str, Any]:
        return {
            "phase": self.phase,
            "class_id": self.class_id,
            "original_scheduled_at": self.original_scheduled_at,
            "proposed_at": self.proposed_at,
            "alternatives_offered": self.alternatives_offered or [],
            "rejected_count": self.rejected_count,
            "started_at": self.started_at,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }


def _read_state(lead_id: str) -> State | None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT reschedule_state FROM leads WHERE id = %s", (lead_id,))
        row = cur.fetchone()
    if not row or not row[0]:
        return None
    raw = row[0]
    if raw.get("phase") == "DONE":
        return None
    return State(
        phase=raw["phase"],
        class_id=raw["class_id"],
        original_scheduled_at=raw["original_scheduled_at"],
        proposed_at=raw.get("proposed_at"),
        alternatives_offered=raw.get("alternatives_offered") or [],
        rejected_count=raw.get("rejected_count") or 0,
        started_at=raw.get("started_at") or "",
    )


def _write_state(lead_id: str, state: State | None) -> None:
    payload = json.dumps(state.to_jsonb()) if state else None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE leads SET reschedule_state = %s WHERE id = %s",
            (payload, lead_id),
        )


def _get_active_trial(lead_id: str) -> dict | None:
    """Devuelve la clase de prueba SCHEDULED del lead (la única, si la hay)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, scheduled_at, teacher_id, duration_minutes,
                   google_calendar_event_id
              FROM classes
             WHERE lead_id = %s
               AND is_trial = TRUE
               AND status = 'scheduled'
             ORDER BY scheduled_at
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
        "google_calendar_event_id": row[4],
    }


# ─────────────────────────────────────────────────────────
# LLM helpers
# ─────────────────────────────────────────────────────────

_DT_EXTRACTOR_SYSTEM = """\
You extract a date and/or time from a Spanish/German WhatsApp message
written by a person who wants to reschedule a German trial class.

Today's reference date is provided in the user message. Resolve relative
expressions: "mañana" → tomorrow, "el viernes" → next Friday in the
future, "la semana que viene" → +7 days, etc.

Output JSON:
  {
    "found": true | false,
    "iso": "ISO 8601 in Europe/Berlin local with offset, or null",
    "ambiguous": true | false,
    "note": "short reason if not found"
  }

If the message proposes a date but not a time → use 18:00 as a reasonable
default afternoon slot AND set ambiguous=true.

If the message gives a time but not a date → use the next occurrence
that's still in the future AND set ambiguous=true.

If the message contains no time/date hint at all → found=false.
"""

_EXTRACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "found":     {"type": "boolean"},
        "iso":       {"type": ["string", "null"]},
        "ambiguous": {"type": "boolean"},
        "note":      {"type": "string"},
    },
    "required": ["found"],
}


def _extract_datetime(text: str) -> dict[str, Any]:
    today_berlin = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d (%A)")
    user = f"Today: {today_berlin}\n\nMessage: {text}"
    try:
        result, _ = complete_json(
            model=MODEL_HAIKU,
            system=_DT_EXTRACTOR_SYSTEM,
            user=user,
            schema=_EXTRACT_SCHEMA,
            max_tokens=200,
        )
        return result
    except Exception as e:
        log.exception("datetime extraction failed: %s", e)
        return {"found": False, "note": "extractor_error"}


# ─────────────────────────────────────────────────────────
# Comunicación con web/api/internal/reschedule/*
# ─────────────────────────────────────────────────────────

def _check_availability(proposed_iso: str, preferred_teacher_id: str, class_id: str) -> dict:
    url = f"{_PLATFORM_URL}/api/internal/reschedule/check-availability"
    res = requests.post(
        url,
        json={
            "proposed_iso": proposed_iso,
            "preferred_teacher_id": preferred_teacher_id,
            "class_id": class_id,
        },
        headers={"x-internal-api-key": _INTERNAL_KEY, "Content-Type": "application/json"},
        timeout=_TIMEOUT,
    )
    res.raise_for_status()
    return res.json()


def _confirm_reschedule(class_id: str, new_start_iso: str, new_teacher_id: str) -> dict:
    url = f"{_PLATFORM_URL}/api/internal/reschedule/confirm"
    res = requests.post(
        url,
        json={
            "class_id": class_id,
            "new_start_iso": new_start_iso,
            "new_teacher_id": new_teacher_id,
            "duration_minutes": TRIAL_DURATION_MIN,
        },
        headers={"x-internal-api-key": _INTERNAL_KEY, "Content-Type": "application/json"},
        timeout=_TIMEOUT,
    )
    return res.json()


# ─────────────────────────────────────────────────────────
# Formato de mensajes
# ─────────────────────────────────────────────────────────

_WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_WEEKDAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
_MONTHS_ES   = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]
_MONTHS_DE   = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"]


def _format_when_berlin(iso: str, language: str) -> str:
    """'jueves 8 de mayo a las 17:00 (Berlín)'."""
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    # Convertimos a Berlin via offset: usamos la API local del datetime
    # con el ZoneInfo. El módulo zoneinfo está en stdlib desde 3.9.
    from zoneinfo import ZoneInfo
    bl = dt.astimezone(ZoneInfo("Europe/Berlin"))
    if language == "de":
        return f"{_WEEKDAYS_DE[bl.weekday()]}, {bl.day}. {_MONTHS_DE[bl.month-1]} um {bl.strftime('%H:%M')} (Berlin)"
    return f"{_WEEKDAYS_ES[bl.weekday()]} {bl.day} de {_MONTHS_ES[bl.month-1]} a las {bl.strftime('%H:%M')} (Berlín)"


def _msg_ask_for_time(language: str, name: str) -> str:
    if language == "de":
        return (
            f"Hallo {name}! 👋 Klar, kein Problem 🙌\n\n"
            "Für wann passt es dir besser? Schreib mir einfach Tag und Uhrzeit "
            "(z. B. 'Donnerstag um 18 Uhr') und ich pruefe die Verfuegbarkeit."
        )
    return (
        f"¡Hola {name}! 👋 Claro, sin problema 🙌\n\n"
        "¿Para qué día y hora te viene bien? Dime el día y la hora "
        "(por ejemplo: \"jueves a las 18h\") y miro la disponibilidad."
    )


def _msg_confirmed(language: str, name: str, when: str, teacher: str) -> str:
    if language == "de":
        return (
            f"Erledigt {name} ✅\n\n"
            f"Deine Probestunde ist jetzt am {when} mit {teacher}.\n\n"
            "Du bekommst auch eine Bestätigung per E-Mail. Bis bald! 🙌"
        )
    return (
        f"¡Listo {name}! ✅\n\n"
        f"Tu clase de prueba es ahora el {when} con {teacher}.\n\n"
        "Te llega también la confirmación por email. ¡Nos vemos! 🙌"
    )


def _msg_alternatives(language: str, name: str, alts: list[dict]) -> str:
    lines = [_format_when_berlin(a["start_iso"], language) for a in alts]
    bullet_list = "\n".join(f"• {l}" for l in lines)
    if language == "de":
        return (
            f"{name}, an dem genauen Zeitpunkt habe ich leider nichts frei. "
            "Diese Termine in der Nähe wären verfügbar:\n\n"
            f"{bullet_list}\n\n"
            "Welcher passt dir? Schreib mir den, der am besten passt."
        )
    return (
        f"{name}, justo a esa hora no tengo libre. Estas alternativas cercanas sí están disponibles:\n\n"
        f"{bullet_list}\n\n"
        "¿Cuál te viene bien? Dime la que mejor te encaje."
    )


def _msg_couldnt_parse(language: str) -> str:
    if language == "de":
        return (
            "Sorry, ich habe Tag/Uhrzeit nicht klar erkannt. Kannst du es so schreiben?\n"
            "👉 z. B. 'Donnerstag um 18 Uhr' oder '9. Mai 17 Uhr'."
        )
    return (
        "Disculpa, no entendí bien el día y hora 🙏 ¿Me lo escribes así?\n"
        "👉 ej. \"jueves a las 18h\" o \"9 de mayo a las 17h\"."
    )


# ─────────────────────────────────────────────────────────
# Entry points (llamado desde agent_4_conversation)
# ─────────────────────────────────────────────────────────

def is_in_flow(lead_id: str) -> bool:
    """True si el lead tiene reschedule_state activo."""
    return _read_state(lead_id) is not None


def handle_inbound(lead: dict, text: str) -> bool:
    """
    Punto de entrada. agent_4_conversation llama esto ANTES de su flujo
    normal. Devuelve True si el flow procesó el mensaje (= agent_4 debe
    salir sin generar respuesta propia).

    Casos:
      - Lead YA en flow → continuar la máquina (parsear hora, validar, etc.)
      - Lead NO en flow → si el mensaje tiene intent reschedule Y el lead
        tiene un trial scheduled → INICIAR el flow.
      - Resto → False (deja que agent_4 haga lo suyo).
    """
    lead_id = lead["id"]
    state = _read_state(lead_id)

    if state is None:
        # ¿Iniciamos?
        if not detect_reschedule_intent(text):
            return False
        trial = _get_active_trial(lead_id)
        if not trial:
            # No hay trial scheduled → no es un caso de "cambio de hora"
            # real; deja a agent_4 procesar normalmente.
            return False
        return _start_flow(lead, trial)

    # Lead ya en flow — continuar.
    if state.phase == "AWAITING_TIME":
        return _handle_awaiting_time(lead, state, text)
    if state.phase == "CONFIRMING":
        # Por ahora NO usamos confirmación explícita ("dime sí" antes de
        # actualizar) — el endpoint /confirm es atómico y idempotente.
        # Si más adelante queremos pasar por una confirmación intermedia,
        # esta rama es donde irá. Por ahora cae a awaiting_time.
        return _handle_awaiting_time(lead, state, text)

    return False


# ─────────────────────────────────────────────────────────
# Transiciones
# ─────────────────────────────────────────────────────────

def _start_flow(lead: dict, trial: dict) -> bool:
    """Lead pidió cambio de hora por primera vez → estado AWAITING_TIME + pregunta."""
    state = State(
        phase="AWAITING_TIME",
        class_id=trial["id"],
        original_scheduled_at=trial["scheduled_at"],
        started_at=datetime.now(timezone.utc).isoformat(),
        alternatives_offered=[],
        rejected_count=0,
    )
    _write_state(lead["id"], state)

    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")
    text = _msg_ask_for_time(lead.get("language") or "es", name)
    log_timeline(
        lead["id"],
        type="agent_note",
        author="system",
        content="🔄 Reschedule flow iniciado (AWAITING_TIME)",
        metadata={"class_id": trial["id"]},
    )
    res = send_approved(lead, text, advance_followup=False)
    if not res.success:
        log.warning("[reschedule] start: send blocked/failed for %s: %s", lead["id"], res.reason)
    return True


def _handle_awaiting_time(lead: dict, state: State, text: str) -> bool:
    """Lead respondió con un horario propuesto. Parsear → validar → confirmar/sugerir."""
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")

    extracted = _extract_datetime(text)
    if not extracted.get("found"):
        # No pudimos extraer fecha — pedir reformulación. NO escalamos
        # rejected_count: esto es del extractor, no del lead rechazando.
        send_approved(lead, _msg_couldnt_parse(lang), advance_followup=False)
        return True

    proposed_iso = extracted.get("iso")
    if not proposed_iso:
        send_approved(lead, _msg_couldnt_parse(lang), advance_followup=False)
        return True

    # Llamar al endpoint de availability
    trial = _get_active_trial(lead["id"]) or {"teacher_id": "", "id": state.class_id}
    try:
        avail = _check_availability(proposed_iso, trial.get("teacher_id") or "", state.class_id)
    except Exception as e:
        log.exception("[reschedule] check-availability call failed: %s", e)
        # Fail-soft: dile al lead que estamos teniendo un problema y
        # escalamos para que un humano lo agarre. NO seguimos el flujo
        # con datos potencialmente inconsistentes.
        update_status(lead["id"], "needs_human", author="system")
        log_timeline(
            lead["id"], type="escalation", author="system",
            content="⚠️ Reschedule: check-availability falló — escalado a needs_human",
            metadata={"error": str(e)[:200]},
        )
        return True

    if avail.get("available"):
        return _confirm_and_finish(lead, state, avail)
    else:
        return _offer_alternatives(lead, state, avail.get("alternatives") or [])


def _confirm_and_finish(lead: dict, state: State, avail: dict) -> bool:
    """Hay slot — UPDATE clase + GCal + confirma al lead."""
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")

    try:
        result = _confirm_reschedule(
            class_id=state.class_id,
            new_start_iso=avail["start_iso"],
            new_teacher_id=avail["teacher_id"],
        )
    except Exception as e:
        log.exception("[reschedule] confirm call threw: %s", e)
        update_status(lead["id"], "needs_human", author="system")
        log_timeline(
            lead["id"], type="escalation", author="system",
            content="⚠️ Reschedule: confirm endpoint falló — escalado",
            metadata={"error": str(e)[:200]},
        )
        return True

    if not result.get("ok"):
        # Slot tomado entre check y confirm, o GCal falló — re-iterar
        # ofreciendo alternativas frescas si las podemos pedir.
        log.warning("[reschedule] confirm rejected: %s", result)
        log_timeline(
            lead["id"], type="agent_note", author="system",
            content=f"⚠️ Reschedule confirm rejected: {result.get('error')}",
            metadata=result,
        )
        # Re-pedir disponibilidad inmediata para poder ofrecer alternativas frescas
        try:
            fresh = _check_availability(avail["start_iso"], avail.get("teacher_id") or "", state.class_id)
            return _offer_alternatives(lead, state, fresh.get("alternatives") or [])
        except Exception:
            update_status(lead["id"], "needs_human", author="system")
            return True

    # Éxito — mensaje al lead + cerrar flow
    when = _format_when_berlin(avail["start_iso"], lang)
    msg = _msg_confirmed(lang, name, when, avail.get("teacher_name") or "tu profesor/a")
    send_approved(lead, msg, advance_followup=False)

    # Marcar DONE y mantener marca histórica del cambio
    state.phase = "DONE"
    _write_state(lead["id"], None)         # limpiar
    log_timeline(
        lead["id"], type="status_change", author="system",
        content=f"✅ Trial reagendado a {avail['start_iso']} (profe={avail.get('teacher_name')})",
        metadata={
            "previous_at": state.original_scheduled_at,
            "new_at": avail["start_iso"],
            "teacher_id": avail["teacher_id"],
            "gcal_patched": result.get("gcal_patched"),
        },
    )
    return True


def _offer_alternatives(lead: dict, state: State, alts: list[dict]) -> bool:
    """No hay slot exacto — ofrecer hasta 3 alternativas o escalar si se acumulan rechazos."""
    lang = lead.get("language") or "es"
    name = (lead.get("name") or "").split()[0] or (lead.get("name") or "")

    if not alts:
        # No hay nada disponible en absoluto — escalar.
        update_status(lead["id"], "needs_human", author="system")
        log_timeline(
            lead["id"], type="escalation", author="system",
            content="⚠️ Reschedule: 0 alternativas disponibles — escalado",
        )
        return True

    state.rejected_count += 1
    state.alternatives_offered = (state.alternatives_offered or []) + [a["start_iso"] for a in alts[:3]]
    _write_state(lead["id"], state)

    if state.rejected_count >= MAX_REJECTIONS_BEFORE_ESCALATE:
        update_status(lead["id"], "needs_human", author="system")
        log_timeline(
            lead["id"], type="escalation", author="system",
            content=f"⚠️ Reschedule: {state.rejected_count} iteraciones sin acuerdo — escalado a humano",
            metadata={"alternatives_offered": state.alternatives_offered},
        )
        return True

    msg = _msg_alternatives(lang, name, alts[:3])
    send_approved(lead, msg, advance_followup=False)
    return True
