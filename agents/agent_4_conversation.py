"""
Agent 4 — CONVERSATION AGENT (El Escucha).

Two-layer architecture (spec: ~60% of inbound messages handled without AI):

  LAYER 1 — Keyword detection (instant, zero cost):
      BOOKING INTENT       → send Calendly link, status=link_sent
      HUMAN REQUEST        → status=needs_human, notify Gelfis, containment
      NEGATIVE / UNSUB     → status=lost, send goodbye, stop
      READ RECEIPT UPDATE  → handled elsewhere (webhook, not here)

  LAYER 2 — AI (only if no keywords matched):
      Sonnet 4.6 with last 5 messages + funnel data + last 3 gelfis notes.
      Output goes through Agent 2 → Agent 3.

Public surface:

    handle_incoming_message(lead, text, *, wa=None) -> HandleResult
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Literal

from datetime import datetime

from agents.agent_1_writer import MessageDraft, compose_reply
from agents.agent_2_reviewer import review_single
from agents.agent_3_sender import send_approved
from agents.shared.db import get_config, get_conn
from agents.shared.leads import log_timeline, reset_reactivation_count, update_status
from agents.shared.rate_limits import BERLIN
from agents.whatsapp_service import WhatsAppService

log = logging.getLogger("agent_4")


# ──────────────────────────────────────────────────────────
# Keyword tables (match on word boundaries, case-insensitive)
# ──────────────────────────────────────────────────────────

# BOOKING — separado en dos categorías para evitar falsos positivos brutales
# como el caso Sara 2026-04-30: dijo "Todo ok y perfecto, tomaré clases en
# una escuela presencial" y "ok" matcheó BOOKING → bot le mandó horarios.
#
#  BOOKING_PHRASES: frases multi-palabra inequívocas — siempre booking.
#  BOOKING_AFFIRMATIONS: afirmaciones cortas — solo cuentan si el mensaje
#                        es BREVE (≤ _BOOKING_AFFIRMATION_MAX_CHARS).
BOOKING_PHRASES = {
    "es": [
        "agendar", "agéndame", "agendame",
        "envíame", "enviame", "envia me",
        "mándame", "mandame", "manda me",
        "manda el link", "manda link", "mándame el link", "mandame el link",
        "envíame el link", "enviame el link",
        "quiero agendar", "quiero reservar", "quiero clase", "quiero la clase",
        "reservar", "reserva", "resérvame", "resérvame", "reservame",
        "book", "booking", "pasa el link", "pásame el link", "pasame el link",
    ],
    "de": [
        "schick mir", "schick den link", "schicke den link",
        "buchen", "termin buchen", "ich buche", "ich möchte buchen",
        "schicke mir den", "ich will buchen",
    ],
}
BOOKING_AFFIRMATIONS = {
    "es": ["si", "sí", "claro", "ok", "okey", "vale", "dale", "quiero", "enlace", "link"],
    "de": ["ja", "klar", "gerne", "okay", "ok", "schick", "schicken", "termin", "link", "buche"],
}
_BOOKING_AFFIRMATION_MAX_CHARS = 25  # mensajes > 25 chars no se interpretan
                                      # como booking aunque contengan "ok"

HUMAN_WORDS = {
    "es": [
        "hablar con persona", "hablar con alguien",
        "llamar", "llamada", "telefono", "teléfono",
        "humano", "persona real", "asesor", "agente",
    ],
    "de": [
        "mit person sprechen", "mit jemandem sprechen",
        "anrufen", "telefon", "mensch", "berater",
        "mitarbeiter", "echte person",
    ],
}

NEGATIVE_WORDS = {
    "es": [
        # rechazo explícito
        "no me escriban más", "no me escriban mas",
        "dejen de escribirme", "dejen de escribir",
        "no me interesa", "ya no me interesa",
        "cancelar", "cancela",
        "borrar", "borra mis datos", "basta", "stop",
        "quiten mi número", "quiten mi numero",
        # rechazo amable / "me voy a otro lado" (caso Sara 2026-04-30)
        "tomaré clases", "tomare clases", "voy a tomar clases",
        "voy a estudiar en", "estudiaré en", "estudiare en",
        "voy a otra academia", "elegí otra", "elegi otra",
        "ya elegí", "ya elegi", "decidí no", "decidi no",
        "ya me inscribí", "ya me inscribi",
        "academia presencial", "escuela presencial",
        "preferí otra", "preferi otra", "preferí no", "preferi no",
        "agradezco tu tiempo", "agradezco el tiempo",
        "agradezco muchísimo tu tiempo", "agradezco muchisimo tu tiempo",
        "gracias por tu tiempo", "muchas gracias por tu tiempo",
        "te deseo buena suerte", "te deseo lo mejor",
        "mejor no", "no por ahora", "por ahora no",
    ],
    "de": [
        "bitte nicht mehr schreiben", "nicht mehr schreiben",
        "abmelden", "kein interesse",
        "nicht interessiert", "stopp", "stop",
        "meine daten löschen",
        # rechazo amable
        "ich gehe zu", "ich besuche eine andere", "ich habe mich entschieden",
        "danke für deine zeit", "danke fuer deine zeit",
        "vielen dank für deine zeit", "vielen dank fuer deine zeit",
        "ich wünsche dir viel erfolg", "ich wuensche dir viel erfolg",
        "andere schule", "präsenzschule", "praesenzschule",
    ],
}

# "Info call" — lead wants a quick phone/video chat with Gelfis BEFORE
# committing to a trial class. We surface this as a separate path so we
# can later route it to a 30-min Google Calendar booking. For now,
# until the Calendar integration ships, the handler escalates to Gelfis
# with a clear flag in the timeline.
INFO_CALL_WORDS = {
    "es": [
        "una llamada", "tener una llamada", "quiero una llamada",
        "podemos hablar", "podríamos hablar", "podriamos hablar",
        "consulta antes", "consultar antes", "consultar contigo",
        "asesoría", "asesoria", "orientación", "orientacion",
        "videollamada", "video llamada", "videocall",
    ],
    "de": [
        "kurzes telefonat", "telefonieren vorab", "vorab telefonieren",
        "beratungsgespräch", "beratung vorab", "vorgespräch",
        "kurzer call", "videocall vorab",
    ],
}

# "Price request" — any signal that the lead specifically wants prices.
# Handled separately from broad-info because the answer is a concrete
# price range + trial-class suggestion, not "see the website".
PRICE_WORDS = {
    "es": [
        "precios", "precio", "cuanto cuesta", "cuánto cuesta",
        "cuanto vale", "cuánto vale", "cuanto sale", "cuánto sale",
        "cuanto pagar", "cuánto pagar", "coste", "costo", "tarifa",
        "tarifas", "que precio", "qué precio", "cuánto es", "cuanto es",
    ],
    "de": [
        "preis", "preise", "was kostet", "wie teuer", "kosten",
        "tarif", "tarife", "wieviel kostet", "wie viel kostet",
    ],
}

# "Broad info request" — when the lead wants details beyond what we'd send
# conversationally (curriculum, teachers, methodology…). We reply with the
# public website URL in one short message.
INFO_WORDS = {
    "es": [
        "más info", "mas info", "más información", "mas informacion",
        "informacion", "información", "detalles",
        "pagina web", "página web",
        "sitio web", "la web", "ver web", "ver la web",
    ],
    "de": [
        "mehr info", "mehr infos", "mehr informationen", "details",
        "webseite", "website", "homepage",
    ],
}

FUNNEL_URL  = "https://b2c.aprender-aleman.de/agendar"
WEBSITE_URL = "https://aprender-aleman.de"
WEB_BASE    = "https://b2c.aprender-aleman.de"

# Standardised sign-off. Used everywhere outbound messages are
# composed by Agent 4. Keep the em-dash + middle-dot exact — Gelfis
# wants this verbatim across the system.
SIGNATURE_ES = "— Stiv · Aprender-Aleman.de"
SIGNATURE_DE = "— Stiv · Aprender-Aleman.de"


def _sig(lang: str) -> str:
    return SIGNATURE_DE if lang == "de" else SIGNATURE_ES


# ──────────────────────────────────────────────────────────
# Slot fetching for booking-intent replies
# ──────────────────────────────────────────────────────────


_slots_cache: list[dict] = []
_slots_cache_ts: float = 0.0
_SLOTS_CACHE_TTL = 120  # seconds


def _fetch_top_trial_slots(top: int = 3) -> list[dict]:
    """Hit the public /api/public/trial-slots endpoint and return the
    first `top` results, with a 120s in-memory cache to avoid
    hammering the endpoint when multiple leads ask to book at once.
    """
    import time
    import httpx

    global _slots_cache, _slots_cache_ts
    now = time.monotonic()
    if _slots_cache and (now - _slots_cache_ts) < _SLOTS_CACHE_TTL:
        return _slots_cache[:top]

    try:
        r = httpx.get(f"{WEB_BASE}/api/public/trial-slots", timeout=8.0)
        r.raise_for_status()
        data = r.json()
        slots = data.get("slots") or []
        _slots_cache = slots
        _slots_cache_ts = now
        return slots[:top]
    except Exception as e:  # noqa: BLE001
        log.warning("Failed to fetch trial slots: %s", e)
        return _slots_cache[:top] if _slots_cache else []


def _format_slot_line(iso: str, lang: str) -> str:
    """One bullet line per slot — '• Mié 30 abr · 13:00 (Berlín)'."""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(BERLIN)
    except Exception:  # noqa: BLE001
        return f"• {iso}"
    if lang == "de":
        weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
        months   = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
                    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]
        return f"• {weekdays[dt.weekday()]} {dt.day}. {months[dt.month-1]} · {dt.strftime('%H:%M')} (Berlin)"
    weekdays_es = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
    months_es   = ["ene", "feb", "mar", "abr", "may", "jun",
                   "jul", "ago", "sep", "oct", "nov", "dic"]
    return f"• {weekdays_es[dt.weekday()]} {dt.day} {months_es[dt.month-1]} · {dt.strftime('%H:%M')} (Berlín)"


def _is_awaiting_trial_decision(lead_id: str) -> bool:
    """True si el lead ASISTIÓ a la trial en los últimos 14 días y aún
    no se ha resuelto su conversión. Lee de leads.trial_attended_at
    (migration 063) — fuente de verdad explícita.

    Antes (bug 2026-06-17): chequeaba lead_timeline.content ILIKE
    "%attended trial%" + requería status='in_conversation'. Pero el
    código TS pone status='trial_attended' tras marcar asistió, NO
    'in_conversation', así que el check nunca matcheaba y Stiv
    respondía con flujo genérico a leads post-trial que escribían
    "ya pagué" / "tuve un problema".
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
              FROM leads
             WHERE id = %s
               AND trial_attended_at IS NOT NULL
               AND trial_attended_at > NOW() - INTERVAL '14 days'
               AND status::text NOT IN ('converted', 'lost')
            """,
            (lead_id,),
        )
        return cur.fetchone() is not None


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower().strip())


def _has_phrase(text_norm: str, phrases: list[str]) -> str | None:
    """Return the first phrase found, or None.

    For short single-word cues like "si"/"ja", we require word boundaries so
    we don't match them inside "solo" / "jahrelang".
    """
    for phrase in phrases:
        if " " in phrase:
            if phrase in text_norm:
                return phrase
        else:
            if re.search(rf"\b{re.escape(phrase)}\b", text_norm):
                return phrase
    return None


# ──────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────


Intent = Literal[
    "booking", "human_request", "negative",
    "price_request", "info_request", "ai_reply",
    "already_converted_ignore", "needs_human_already_paused_ignore",
    "trial_already_booked", "ai_paused_by_admin",
]


@dataclass
class HandleResult:
    intent: Intent
    sent: bool
    message_sent: str = ""


def handle_incoming_message(
    lead: dict,
    text: str,
    *,
    wa: WhatsAppService | None = None,
) -> HandleResult:
    """Process an inbound WhatsApp message from a lead."""
    status = lead.get("status")
    lang = lead.get("language", "es")

    # Always log the incoming message first — audit trail.
    log_timeline(
        lead["id"],
        type="lead_message_received",
        author="lead",
        content=text,
    )

    # El lead acaba de escribir → está engaged otra vez. Reseteamos el
    # contador de reactivaciones para que un futuro silencio empiece de cero.
    # (No-op si ya estaba en 0.)
    reset_reactivation_count(lead["id"])

    # Pausar cadena automática 24h si hay una activa — la conversación
    # humana tiene prioridad. La cadena se reanuda sola cuando expire.
    _pause_active_chain(lead["id"])

    # Once converted, NEVER auto-reply (spec).
    if status == "converted":
        log.info("Lead %s converted — ignoring inbound.", lead["id"])
        return HandleResult("already_converted_ignore", sent=False)

    # If paused for human, do not auto-reply.
    if status == "needs_human":
        log.info("Lead %s in needs_human — holding.", lead["id"])
        return HandleResult("needs_human_already_paused_ignore", sent=False)

    # POST-TRIAL DECISIÓN PENDIENTE: cuando Gelfis marca al lead como
    # asistido (markTrialAttendedAwaitingConversion en web/lib/admin-
    # actions.ts), el sistema lo deja en status='in_conversation' + un
    # status_change con content "Lead attended trial — awaiting...".
    # Mientras esa decisión esté pendiente y no haya conversion ni lost,
    # el bot NO debe auto-mensajear. Caso Sara 2026-04-30 donde el bot
    # le ofreció horarios a alguien que iba a otra academia.
    # Acepta 'trial_attended' (status real tras marcar Asistió) y
    # 'in_conversation' (transicion legacy). _is_awaiting_trial_decision
    # YA exige que trial_attended_at esté seteado, así que es seguro
    # ampliar el match de status sin re-disparar para leads que
    # ya pasaron a converted/lost (el check los excluye).
    if status in ("trial_attended", "in_conversation") and _is_awaiting_trial_decision(lead["id"]):
        log.info("Lead %s post-trial pendiente decisión — escalando a Gelfis (needs_human).", lead["id"])
        # Decisión Gelfis 2026-06-05: cualquier respuesta del lead tras
        # haber recibido el link de pago debe escalar a needs_human
        # (no solo notificar). Casos típicos: "sí, ya pagué", "tuve un
        # problema con el pago", "¿cuánto cuesta?". Todos requieren
        # acción humana — Stiv no debe responder.
        update_status(lead["id"], "needs_human", author="agent_4")
        log_timeline(
            lead["id"], type="escalation", author="agent_4",
            content=f"Post-trial decisión: lead respondió — escalado a needs_human. \"{text[:200]}\"",
            metadata={"alert_gelfis": True, "reason": "post_trial_reply"},
        )
        try:
            from agents.notifications import notify_trial_attended_pending
            notify_trial_attended_pending(lead)
        except Exception:                               # noqa: BLE001
            pass
        return HandleResult("trial_attended_escalated", sent=False)

    # Per-lead admin takeover: when Gelfis presses "Tomo yo desde aquí"
    # in /admin/leads/[id], the row gets `ai_paused_until` set into the
    # future. Stiv stays silent until that moment passes (or admin
    # clicks "Reactivar Stiv"). The pause does NOT change the funnel
    # status — counters and follow-up scheduling are untouched.
    paused_until = lead.get("ai_paused_until")
    if paused_until:
        try:
            # Both naive ISO and aware ISO are tolerated.
            until_dt = (
                datetime.fromisoformat(paused_until.replace("Z", "+00:00"))
                if isinstance(paused_until, str)
                else paused_until
            )
            now_utc = datetime.now(BERLIN).astimezone(until_dt.tzinfo) if until_dt.tzinfo else datetime.utcnow()
            if until_dt > now_utc:
                log.info("Lead %s: Stiv paused by admin until %s — holding.", lead["id"], until_dt)
                return HandleResult("ai_paused_by_admin", sent=False)
        except (ValueError, TypeError) as e:
            log.warning("Lead %s: could not parse ai_paused_until=%r (%s) — ignoring pause.", lead["id"], paused_until, e)

    # ── SUMMER PROMO REPLY (Gelfis 2026-06-19) ──────────────────
    # Si el lead recibió summer_promo_msg 1/2/3 y responde, toma control
    # ANTES que cualquier otro flow:
    #   - Si dice horario (mañana/tarde/noche/finde) → manda link
    #     inscripción + escala a needs_human (equipo llama).
    #   - Si responde otra cosa → escala a needs_human directo (Gelfis
    #     atiende manualmente).
    if (lead.get("summer_promo_step") or 0) in (1, 2, 3):
        res = _try_handle_summer_promo_reply(lead, text, wa)
        if res is not None:
            return res

    # ── RESCHEDULE FLOW ────────────────────────────────────────
    # Antes de cualquier flujo conversacional, dar prioridad al state
    # machine de "cambio de hora del trial". Toma control si:
    #   (a) el lead ya está en flujo (continúa la conversación), o
    #   (b) detecta intent reschedule + lead tiene trial scheduled.
    # Si maneja el mensaje, retornamos sin pasar por agent_1/2/3 normal.
    try:
        from agents.reschedule_flow import handle_inbound as _resched_inbound
        if _resched_inbound(lead, text):
            return HandleResult("reschedule_flow_handled", sent=True)
    except Exception:                                    # noqa: BLE001
        log.exception("[reschedule_flow] uncaught exception — caer al flujo normal")

    text_norm = _norm(text)
    other_lang = "es" if lang == "de" else "de"

    # NEGATIVE / HUMAN-request still win over the trial-already-booked branch:
    # someone who asks to unsubscribe or asks for a human deserves the right
    # response regardless of their booking state.
    if _has_phrase(text_norm, NEGATIVE_WORDS[lang] + NEGATIVE_WORDS[other_lang]):
        return _handle_negative(lead, wa)

    if _has_phrase(text_norm, HUMAN_WORDS[lang] + HUMAN_WORDS[other_lang]):
        return _handle_human_request(lead, wa)

    # ABSENT-FOLLOWUP POSITIVE REPLY — el lead no asistió al trial y la
    # cadena tick_absent_followups ya le mandó "¿mantienes el interés?"
    # (FU1) o variantes (FU2/3). Si responde algo positivo ("sí", "claro",
    # "ja", "me interesa"), le mandamos el link self-serve /agendar/cuando
    # y paramos la cadena absent_followup (Gelfis 2026-06-17, caso Jhon).
    if status in ("trial_absent", "absent_followup_1",
                  "absent_followup_2", "absent_followup_3"):
        if _looks_positive(text_norm, lang):
            return _handle_absent_followup_positive(lead, wa)

    # TRIAL ALREADY BOOKED — if the lead already has a scheduled trial,
    # NEVER push them to book again. Recognise the state and respond with
    # the booking details, plus a soft prompt asking what they need. This
    # catches both the self-book funnel path AND the legacy WhatsApp path
    # once the lead has reserved.
    if status in ("trial_scheduled", "trial_reminded"):
        return _handle_trial_already_booked(lead, text, wa)

    # WELCOME MOTIVATION REPLY — el msg 1 del drip ahora pregunta motivación
    # (1=Trabajo · 2=Estudios · 3=Pareja · 4=Otra). Si el lead respondió con
    # uno de esos números, mandamos copy específico con CTA agendar trial
    # (Gelfis 2026-06-14). Gate: last_drip_msg_n EXACTAMENTE 1 — sólo el
    # primer ciclo de respuesta, no después de avanzar el drip.
    if status == "registered" and (lead.get("last_drip_msg_n") or 0) == 1:
        res = _try_handle_welcome_motivation(lead, text, wa)
        if res is not None:
            return res

    # INFO-CALL TIME PROPOSAL — el msg 1 del drip ahora le propone al lead
    # una llamada informativa de 15 min con Gelfis (cambio 2026-05-14). Si
    # el lead respondió con una hora ("mañana a las 10", "hoy a las 18:30",
    # etc.) parseamos vía Claude y agendamos en Google Calendar.
    #
    # Gate: status='registered' (drip activo) AND last_drip_msg_n >= 1
    # (msg 1 ya salió). El handler devuelve None si no parece propuesta de
    # hora → caemos al flujo normal.
    if status == "registered" and (lead.get("last_drip_msg_n") or 0) >= 1:
        res = _try_handle_call_time_proposal(lead, text, wa)
        if res is not None:
            return res

    # LAYER 1 — keywords (zero AI cost). Order matters: info-call wins
    # over booking ("quiero una llamada" mustn't fire booking on "quiero").
    if _has_phrase(text_norm, INFO_CALL_WORDS[lang] + INFO_CALL_WORDS[other_lang]):
        return _handle_info_call_request(lead, wa)

    # Frases multi-palabra inequívocas → siempre booking
    if _has_phrase(text_norm, BOOKING_PHRASES[lang]):
        return _handle_booking(lead, wa)
    # Afirmaciones cortas ("sí", "ok", "vale") → SOLO si el mensaje es breve
    # (≤ _BOOKING_AFFIRMATION_MAX_CHARS). Evita el caso Sara: "Todo ok y
    # perfecto, tomaré clases en una escuela presencial" matcheaba "ok"
    # como booking. Si el mensaje es largo, es conversación, no booking.
    if (len(text_norm) <= _BOOKING_AFFIRMATION_MAX_CHARS
        and _has_phrase(text_norm, BOOKING_AFFIRMATIONS[lang])):
        return _handle_booking(lead, wa)

    # Price questions get a concrete answer BEFORE the generic info bucket
    # — both banks contain overlapping keywords and we want the specific
    # response to win.
    if _has_phrase(text_norm, PRICE_WORDS[lang] + PRICE_WORDS[other_lang]):
        return _handle_price_request(lead, wa)

    if _has_phrase(text_norm, INFO_WORDS[lang] + INFO_WORDS[other_lang]):
        return _handle_info_request(lead, wa)

    # LAYER 2 — AI reply
    return _handle_ai_reply(lead, text, wa)


# ──────────────────────────────────────────────────────────
# Handlers
# ──────────────────────────────────────────────────────────


def _trial_class_details(lead_id: str) -> tuple[datetime | None, str | None]:
    """Look up the lead's upcoming trial class (date, teacher name).

    The funnel writes its booking into the `classes` table with `is_trial=true`
    and `lead_id`. We pull the soonest one in the future. Falls back to the
    legacy `leads.trial_scheduled_at` (Calendly-era) if no class row exists.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.scheduled_at,
                   COALESCE(u.full_name, u.email) AS teacher_name
              FROM classes c
              JOIN teachers t ON t.id = c.teacher_id
              JOIN users    u ON u.id = t.user_id
             WHERE c.lead_id = %s
               AND c.is_trial = TRUE
               AND c.status IN ('scheduled', 'live')
               AND c.scheduled_at >= NOW() - INTERVAL '1 hour'
             ORDER BY c.scheduled_at ASC
             LIMIT 1
            """,
            (lead_id,),
        )
        row = cur.fetchone()
    if row:
        return row["scheduled_at"], row["teacher_name"]

    # Legacy fallback — lead.trial_scheduled_at without a classes row.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT trial_scheduled_at FROM leads WHERE id = %s",
            (lead_id,),
        )
        r = cur.fetchone()
    return (r["trial_scheduled_at"] if r else None), None


def _pause_active_chain(lead_id: str) -> None:
    """Pausa la cadena activa del lead por 24h cuando responde por WA."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE lead_chains
               SET paused_until = NOW() + INTERVAL '24 hours',
                   updated_at   = NOW()
             WHERE lead_id = %s
               AND completed_at IS NULL
            """,
            (lead_id,),
        )
        conn.commit()


def _format_trial_when(dt: datetime | None, lang: str) -> str:
    """Formatea fecha/hora del trial en el idioma del lead.

    NO usar strftime('%A') — depende del locale del sistema (en el
    container Docker es 'C'/'en_US' → suelta 'Thursday' en mensaje
    alemán). Hard-coded por idioma garantiza consistencia."""
    if not dt:
        return "pronto" if lang == "es" else "bald"
    local = dt.astimezone(BERLIN) if dt.tzinfo else BERLIN.localize(dt)

    if lang == "de":
        weekdays_de = ["Montag", "Dienstag", "Mittwoch", "Donnerstag",
                       "Freitag", "Samstag", "Sonntag"]
        months_de = ["Januar", "Februar", "März", "April", "Mai", "Juni",
                     "Juli", "August", "September", "Oktober", "November", "Dezember"]
        return (
            f"{weekdays_de[local.weekday()]}, {local.day}. "
            f"{months_de[local.month - 1]} {local.year} um "
            f"{local.strftime('%H:%M')} (Berlin)"
        )
    # Spanish
    weekdays_es = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    months_es   = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                   "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    return (
        f"{weekdays_es[local.weekday()]} {local.day} de {months_es[local.month - 1]} "
        f"a las {local.strftime('%H:%M')} (Berlín)"
    )


def _handle_trial_already_booked(
    lead: dict, incoming: str, wa: WhatsAppService | None,
) -> HandleResult:
    """Lead already has a trial scheduled. Don't push booking — confirm
    the time only.

    Política Gelfis 2026-04-30:
      • NO mencionar el nombre del profesor (interno, no relevante al lead)
      • NO añadir preguntas tipo "¿en qué te puedo ayudar?" — esto es
        confirmación, no apertura de conversación
      • Día de la semana en idioma del lead (no en inglés)

    Si el mensaje del lead es solo confirmación corta ("Ja", "ok", "sí",
    "perfecto", etc.) usamos un acuse estático breve. Para preguntas reales
    pasamos al AI con contexto.
    """
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    lang = lead.get("language", "es")
    when_dt, _teacher_name = _trial_class_details(lead["id"])  # teacher ignorado por política
    when_str = _format_trial_when(when_dt, lang)

    # Detectar si el lead solo confirma (mensaje corto + palabra de
    # afirmación). En ese caso, acuse estático sin invitar conversación.
    incoming_norm = (incoming or "").strip().lower()
    SHORT_CONFIRM = {
        "es": {"si", "sí", "ok", "okey", "vale", "perfecto", "claro", "dale",
               "genial", "gracias", "muchas gracias"},
        "de": {"ja", "ok", "okay", "klar", "perfekt", "danke", "vielen dank",
               "alles klar"},
    }
    is_short_confirm = (
        len(incoming_norm) <= 25
        and any(w in SHORT_CONFIRM[lang] for w in incoming_norm.replace("!", "").replace(".", "").split())
    )

    if is_short_confirm:
        # Política Gelfis 2026-06-10: NO respondemos al acuse del lead.
        # El WhatsApp de confirmación de booking ya pide el "Sí"; cuando
        # llega, el sistema lo recibe vía webhook entrante y los
        # recordatorios automáticos (T-24h / mañana / T-30min) cubren el
        # resto. Mandar un "Perfecto, confirmado" extra solo era ruido.
        return HandleResult("trial_already_booked", sent=False, message_sent=None)

    # Mensaje no-confirmación → pasar al AI con contexto fáctico.
    facts_es = (
        f"[CONTEXTO INTERNO — NO REPETIR LITERAL]\n"
        f"Este lead YA TIENE clase de prueba reservada: {when_str}.\n"
        f"NO le ofrezcas reservar otra clase. NO menciones el nombre del profesor. "
        f"NO añadas preguntas tipo '¿en qué te puedo ayudar?'. "
        f"Si solo confirma, simplemente confírmaselo. Responde brevemente "
        f"a su mensaje actual."
    )
    facts_de = (
        f"[INTERNER KONTEXT — NICHT WÖRTLICH WIEDERHOLEN]\n"
        f"Dieser Lead hat BEREITS eine Probestunde gebucht: {when_str}.\n"
        f"BIETE KEINE neue Buchung an. NENNE NICHT den Namen des Lehrers. "
        f"FÜGE KEINE Fragen wie 'Wie kann ich dir helfen?' hinzu. "
        f"Wenn er nur bestätigt, bestätige es einfach kurz. Antworte kurz "
        f"auf seine aktuelle Nachricht."
    )
    facts = facts_de if lang == "de" else facts_es
    augmented = f"{facts}\n\n[MENSAJE DEL LEAD]\n{incoming}"

    draft = compose_reply(lead, augmented)
    if draft is None or not review_single(lead, draft).approved:
        # FIX Gelfis 2026-06-14 (caso Nadyn): el fallback estatico
        # "Tu clase de prueba es el {when_str}" es INUTIL — repite info
        # que el lead ya sabia e IGNORA lo que dijo (ej: "no podré,
        # perdon"). En su lugar, escalar silenciosamente a needs_human
        # para que Gelfis responda manualmente con contexto.
        update_status(lead["id"], "needs_human", author="agent_4")
        log_timeline(
            lead["id"], type="escalation", author="agent_4",
            content=f"Lead con trial booked escribio algo que la IA no supo manejar: \"{incoming[:200]}\"",
            metadata={"alert_gelfis": True, "kind": "trial_booked_fallback_escalated"},
        )
        return HandleResult("trial_already_booked", sent=False, message_sent=None)
    body = draft.text

    result = send_approved(lead, body, is_new_conversation=False,
                           advance_followup=False, wa=wa)
    return HandleResult("trial_already_booked", sent=result.success, message_sent=body)


def _handle_booking(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    """Lead said yes to booking. Native flow (no Calendly):
    fetch the next 3 free trial slots and propose them inline.

    The lead replies with a slot + their level + email; the actual
    booking step happens once tool-use is wired into Stiv. For now
    Gelfis sees a needs_human-style ping when the lead picks one and
    closes the loop. The pivot from Calendly to native booking is the
    point — we no longer hand them a link and lose sight of them.
    """
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    slots = _fetch_top_trial_slots(top=3)

    if not slots:
        # API down or no availability — soft fallback so the lead
        # isn't left hanging. Still drops them on the funnel as a
        # safety net.
        if lang == "de":
            body = (
                f"Super, {name}! 🎉\n\n"
                f"Im Moment habe ich keine freien Termine zur Hand — du kannst "
                f"hier direkt einen aussuchen:\n{FUNNEL_URL}\n\n"
                f"{_sig(lang)}"
            )
        else:
            body = (
                f"¡Genial, {name}! 🎉\n\n"
                f"Ahora mismo no tengo huecos a mano — puedes elegir uno "
                f"directamente aquí:\n{FUNNEL_URL}\n\n"
                f"{_sig(lang)}"
            )
    else:
        slot_lines = "\n".join(_format_slot_line(s["startIso"], lang) for s in slots)
        if lang == "de":
            body = (
                f"Super, {name}! 🎉\n\n"
                f"Die nächsten freien Probestunden (45 Min, gratis):\n\n"
                f"{slot_lines}\n\n"
                f"Schreib mir, welcher Termin passt, dazu dein Niveau (A0–C2) "
                f"und deine E-Mail — und ich buche dich rein.\n\n"
                f"{_sig(lang)}"
            )
        else:
            body = (
                f"¡Genial, {name}! 🎉\n\n"
                f"Estos son los próximos huecos para tu clase de prueba "
                f"(45 min, gratis):\n\n"
                f"{slot_lines}\n\n"
                f"Dime cuál te va, tu nivel (A0–C2) y tu email, y te lo "
                f"reservo.\n\n"
                f"{_sig(lang)}"
            )
    update_status(lead["id"], "in_conversation", author="agent_4")
    result = send_approved(lead, body, is_new_conversation=False, advance_followup=False, wa=wa)
    return HandleResult("booking", sent=result.success, message_sent=body)


def _try_handle_call_time_proposal(
    lead: dict, text: str, wa: WhatsAppService | None,
) -> HandleResult | None:
    """Lead respondió al msg 1 del drip de followups proponiendo una hora.

    Pasos:
      1. Pedirle a Claude (Haiku) que extraiga un datetime ISO desde el
         texto del lead, usando "ahora" en Europe/Berlin como ancla.
      2. Si Claude devuelve un horario válido → llamar al endpoint
         /api/internal/info-call/book.
      3. Confirmar al lead o pedir otra hora si está ocupado.

    Devuelve `None` (= "no era una propuesta de hora") si Claude no
    detecta intención de proponer horario — el caller cae al flujo normal.
    """
    import json as _json
    import os as _os
    from datetime import timedelta
    import httpx

    from agents.shared.claude_client import MODEL_HAIKU, complete_json

    lang = lead.get("language", "es")
    name_first = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""

    # 1) Parsear hora con Claude
    now_berlin = datetime.now(BERLIN)
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["proposes_time", "datetime_iso", "ambiguous", "reasoning"],
        "properties": {
            "proposes_time": {
                "type": "boolean",
                "description": "True solo si el mensaje propone una hora/momento concreto para una llamada o pregunta sobre disponibilidad. False si es una pregunta, queja, negativa, o tema no relacionado.",
            },
            "datetime_iso": {
                "type": ["string", "null"],
                "description": "ISO 8601 con offset Europe/Berlin (ej '2026-05-15T10:00:00+02:00'). Null si proposes_time=false o si la hora es demasiado vaga.",
            },
            "ambiguous": {
                "type": "boolean",
                "description": "True si la hora es ambigua (ej 'por la tarde' sin hora concreta, 'cuando puedas').",
            },
            "reasoning": { "type": "string", "description": "Breve explicación (≤ 80 chars)." },
        },
    }
    system = (
        f"Eres un parser de fechas en español/alemán. Dado un mensaje de WhatsApp de un lead, "
        f"determina si propone una hora concreta para una llamada de 15 min.\n\n"
        f"ANCLA TEMPORAL: ahora son las {now_berlin.strftime('%Y-%m-%d %H:%M')} hora de Berlín "
        f"({now_berlin.strftime('%A')}). Resuelve frases relativas ('hoy', 'mañana', 'pasado mañana', "
        f"'el lunes', 'esta tarde', 'a las 5') a partir de este momento.\n\n"
        f"REGLAS:\n"
        f"- 'por la tarde' / 'cuando puedas' / 'en cualquier momento' → ambiguous=true, datetime_iso=null.\n"
        f"- 'mañana a las 10' (sin AM/PM en contexto laboral) → 10:00 si es razonable (10am).\n"
        f"- 'a las 5 de la tarde' → 17:00. 'a las 5' sin contexto → 17:00 (asumimos laboral).\n"
        f"- Si el lead solo dice 'sí', 'ok', 'vale', 'no gracias' → proposes_time=false.\n"
        f"- Si hace una pregunta sin proponer hora (ej '¿cuánto cuesta?') → proposes_time=false."
    )
    user = f"Idioma del lead: {lang}\nMensaje:\n{text.strip()[:500]}"

    try:
        parsed, _ = complete_json(
            model=MODEL_HAIKU, system=system, user=user, schema=schema,
            max_tokens=200, cache_system=False,
        )
    except Exception as e:                                       # noqa: BLE001
        log.warning("[call_time] claude parse failed lead=%s: %s", lead["id"], e)
        return None

    if not parsed.get("proposes_time"):
        return None  # No es una propuesta — caer al flujo normal

    # 2) Hora ambigua → pedir aclaración. Cuenta como "manejado" (no caer).
    if parsed.get("ambiguous") or not parsed.get("datetime_iso"):
        body = (
            f"Hallo {name_first}, kannst du mir eine konkrete Uhrzeit nennen? "
            f"Z.B. 'morgen 10:00' oder 'heute 17:30'.\n\n{_sig(lang)}"
            if lang == "de"
            else
            f"¡Hola {name_first}! ¿Podrías darme una hora concreta? "
            f"Por ejemplo: 'mañana a las 10:00' o 'hoy 17:30'.\n\n{_sig(lang)}"
        )
        result = send_approved(lead, body, is_new_conversation=False,
                               advance_followup=False, wa=wa)
        log_timeline(
            lead["id"], type="agent_note", author="agent_4",
            content="Propuesta de hora ambigua — pidiendo concreción.",
            metadata={"kind": "call_time_ambiguous", "raw_text": text[:300],
                      "parser_reasoning": parsed.get("reasoning", "")},
        )
        return HandleResult("ai_reply", sent=result.success, message_sent=body)

    # 3) Hora válida → intentar agendar
    try:
        start = datetime.fromisoformat(str(parsed["datetime_iso"]).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        log.warning("[call_time] claude returned unparseable iso: %r", parsed.get("datetime_iso"))
        return None

    cron_secret = _os.environ.get("CRON_SECRET")
    if not cron_secret:
        log.error("[call_time] CRON_SECRET missing — no puedo llamar al endpoint de booking")
        return None

    payload = {"lead_id": lead["id"], "start_iso": start.isoformat(), "duration_minutes": 15}
    try:
        r = httpx.post(
            f"{WEB_BASE}/api/internal/info-call/book",
            json=payload,
            headers={"Authorization": f"Bearer {cron_secret}"},
            timeout=15.0,
        )
    except Exception as e:                                       # noqa: BLE001
        log.error("[call_time] booking request failed: %s", e)
        return None

    # Format pretty time for the reply
    nice_time = start.astimezone(BERLIN).strftime("%A %d/%m a las %H:%M")
    # Capitalize weekday in es: lunes → Lunes
    nice_time = nice_time[:1].upper() + nice_time[1:]

    if r.status_code == 200:
        # ¡Agendada!
        body = (
            f"Super, {name_first}! Termin gespeichert: {nice_time} (Berliner Zeit). "
            f"Ich rufe dich pünktlich auf WhatsApp an.\n\n{_sig(lang)}"
            if lang == "de"
            else
            f"¡Perfecto, {name_first}! Te llamo el {nice_time} (hora Berlín). "
            f"Te marco por WhatsApp puntual.\n\n{_sig(lang)}"
        )
        result = send_approved(lead, body, is_new_conversation=False,
                               advance_followup=False, wa=wa)
        return HandleResult("ai_reply", sent=result.success, message_sent=body)

    if r.status_code == 409:
        # Ocupado — pedir otra hora
        body = (
            f"Ay, {name_first}, justo a esa hora ya tengo otra cosa. "
            f"¿Me das otra alternativa de hoy o mañana?\n\n{_sig(lang)}"
            if lang != "de"
            else
            f"Hallo {name_first}, zu der Uhrzeit habe ich leider schon einen Termin. "
            f"Hast du eine andere Option für heute oder morgen?\n\n{_sig(lang)}"
        )
        result = send_approved(lead, body, is_new_conversation=False,
                               advance_followup=False, wa=wa)
        log_timeline(
            lead["id"], type="agent_note", author="agent_4",
            content=f"Hora propuesta ocupada ({nice_time}) — pidiendo alternativa.",
            metadata={"kind": "call_time_busy", "proposed_iso": start.isoformat()},
        )
        return HandleResult("ai_reply", sent=result.success, message_sent=body)

    # Otros errores: log + caer al flujo normal para que la IA general gestione
    try:
        err_body = r.json()
    except Exception:                                            # noqa: BLE001
        err_body = {"raw": r.text[:200]}
    log.error("[call_time] booking failed status=%d body=%r", r.status_code, err_body)
    # Para casos como in_the_past, too_far_in_future devolvemos un mensaje
    # específico y consideramos manejado:
    if r.status_code == 400 and err_body.get("error") == "in_the_past":
        body = (
            f"Esa hora ya pasó, {name_first} 😅. ¿Otra opción para hoy o mañana?\n\n{_sig(lang)}"
            if lang != "de"
            else
            f"Diese Uhrzeit ist schon vorbei, {name_first} 😅. Hast du eine andere Option für heute oder morgen?\n\n{_sig(lang)}"
        )
        result = send_approved(lead, body, is_new_conversation=False,
                               advance_followup=False, wa=wa)
        return HandleResult("ai_reply", sent=result.success, message_sent=body)
    if r.status_code == 400 and err_body.get("error") == "too_far_in_future":
        body = (
            f"Mejor agendamos esta semana o la próxima. ¿Te viene bien hoy o mañana, {name_first}?\n\n{_sig(lang)}"
            if lang != "de"
            else
            f"Buchen wir lieber diese oder nächste Woche. Geht heute oder morgen, {name_first}?\n\n{_sig(lang)}"
        )
        result = send_approved(lead, body, is_new_conversation=False,
                               advance_followup=False, wa=wa)
        return HandleResult("ai_reply", sent=result.success, message_sent=body)

    return None  # error inesperado → caer al flujo normal (LLM intentará)


# ──────────────────────────────────────────────────────────
# WELCOME MOTIVATION (msg 1 del drip)
# ──────────────────────────────────────────────────────────

_BOOK_URL = f"{os.environ.get('PLATFORM_URL', 'https://b2c.aprender-aleman.de').rstrip('/')}/agendar/cuando"

# Match "1", "1.", "1)", "  1  ", "número 1", "respondo 1", etc.
# Limitado a 30 chars para evitar matchear "1 cosa más:..." (donde el 1
# es enumeración, no respuesta motivacional).
_DIGIT_RE = re.compile(r"^\s*(?:respuesta\s+|opci[óo]n\s+|n[úu]mero\s+|el\s+)?([1-4])\s*[\.\)\,]?\s*$", re.IGNORECASE)


def _motivation_reply(choice: str, name_first: str) -> str:
    """Copy específico por motivación 1/2/3/4. Gelfis 2026-06-14."""
    if choice == "1":   # Trabajo
        return (
            f"¡Genial {name_first}! 💼\n\n"
            f"Trabajar en Alemania o Suiza puede cambiar tu vida. Los salarios son altos y el nivel de alemán que tengas determina cuánto puedes ganar.\n\n"
            f"En tu clase de prueba GRATIS (30 min) te muestro el plan exacto para llegar al nivel que necesitas para tu sector.\n\n"
            f"📅 Agenda aquí: {_BOOK_URL}"
        )
    if choice == "2":   # Universidad
        return (
            f"¡Excelente {name_first}! 🎓\n\n"
            f"Las universidades alemanas son top mundial y GRATUITAS. Pero los plazos son estrictos y necesitas C1 + TestDaF.\n\n"
            f"En tu clase de prueba GRATIS (30 min) te muestro el roadmap exacto para llegar a tiempo a la aplicación de tu carrera.\n\n"
            f"📅 Agenda aquí: {_BOOK_URL}"
        )
    if choice == "3":   # Pareja
        return (
            f"¡Qué lindo {name_first}! 💕\n\n"
            f"Aprender alemán por tu pareja es una de las mejores razones. Te abre las puertas a su familia, su cultura y vuestro futuro juntos.\n\n"
            f"En tu clase de prueba GRATIS (30 min) te muestro cómo llegar a hablar con su familia naturalmente en pocos meses.\n\n"
            f"📅 Agenda aquí: {_BOOK_URL}"
        )
    # choice == "4" — Otra razón
    return (
        f"Cada motivación es válida {name_first} 😊\n\n"
        f"Cuéntame más cuando hablemos. Lo importante es que quieres aprender alemán y nosotros te ayudamos a lograrlo.\n\n"
        f"En tu clase de prueba GRATIS (30 min) vemos tu nivel, te muestro el método y decides si encaja contigo.\n\n"
        f"📅 Agenda aquí: {_BOOK_URL}"
    )


_MOTIVATION_LABEL = {
    "1": "trabajo",
    "2": "estudios",
    "3": "pareja",
    "4": "otra",
}


def _try_handle_welcome_motivation(
    lead: dict, text: str, wa: WhatsAppService | None,
) -> HandleResult | None:
    """Si el lead responde 1/2/3/4 al msg 1 del drip, mandamos copy
    específico por motivación. Si responde otra cosa, devolvemos None
    y dejamos que el flujo normal (keywords + AI) lo gestione.

    Return None → caer al flujo normal.
    Return HandleResult → ya manejado, no seguir.
    """
    digit_m = _DIGIT_RE.match(text)
    if not digit_m:
        return None   # no es 1/2/3/4 — flujo normal sigue

    choice     = digit_m.group(1)
    name_first = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    body       = _motivation_reply(choice, name_first)

    log_timeline(
        lead["id"],
        type="agent_note",
        author="agent_4",
        content=f"💡 Lead respondió motivación: {choice} ({_MOTIVATION_LABEL[choice]})",
        metadata={"kind": "welcome_motivation_reply", "choice": choice, "label": _MOTIVATION_LABEL[choice]},
    )
    result = send_approved(
        lead, body, is_new_conversation=False, advance_followup=False, wa=wa,
    )
    return HandleResult("welcome_motivation_reply", sent=result.success, message_sent=body)


def _handle_info_call_request(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    """Lead wants a 30-min info call with Gelfis (vs a trial class).

    Until the Google Calendar integration is wired (Phase B), this
    sends a short acknowledgement and escalates to needs_human with a
    `info_call_requested` flag in the timeline so Gelfis can offer
    real slots from his calendar.
    """
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    if lang == "de":
        body = (
            f"Klar, {name}! 👋\n\n"
            f"Gelfis (CEO) ruft dich gern für ein kurzes Gespräch (30 Min) an. "
            f"Er meldet sich heute oder morgen mit konkreten Terminen.\n\n"
            f"{_sig(lang)}"
        )
    else:
        body = (
            f"¡Claro, {name}! 👋\n\n"
            f"Gelfis (CEO) puede tener una llamada contigo (30 min). "
            f"Hoy o mañana te pasa horarios concretos.\n\n"
            f"{_sig(lang)}"
        )
    update_status(lead["id"], "needs_human", author="agent_4")
    log_timeline(
        lead["id"],
        type="escalation",
        author="agent_4",
        content="Lead requested an info call (30 min). Pending slot proposal from Gelfis.",
        metadata={"alert_gelfis": True, "info_call_requested": True},
    )
    result = send_approved(lead, body, is_new_conversation=False, advance_followup=False, wa=wa)
    return HandleResult("human_request", sent=result.success, message_sent=body)


def _handle_price_request(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    """Specific answer to "how much does it cost".

    We don't dump the whole catalog — per Gelfis, the honest line is:
    "we have formations from 285 € to 3 000+ €, depending on level and
    intensity; the right move is a trial class so we can price your
    exact plan". Keep it warm, end with a soft CTA for the trial class
    (don't auto-send the Calendly link yet — wait for them to say yes).
    """
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    if lang == "de":
        body = (
            f"Hallo {name}! 👋\n\n"
            f"Unsere Kurse liegen zwischen 285 € und über 3 000 €, je nach "
            f"Niveau, Intensität und Dauer.\n\n"
            f"Am besten buchst du eine kostenlose Probestunde: wir bewerten "
            f"dein Niveau und erstellen einen Plan (mit genauem Preis) "
            f"nach Maß.\n\n"
            f"Soll ich dir den Link zum Buchen schicken?\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    else:
        body = (
            f"¡Hola {name}! 👋\n\n"
            f"Nuestras formaciones van desde 285 € hasta más de 3 000 €, "
            f"según el nivel, la intensidad y duración que necesites.\n\n"
            f"Lo mejor es que agendes una clase de prueba gratuita: así tu "
            f"profesor evalúa tu nivel y te hace un plan (con precio exacto) "
            f"a medida.\n\n"
            f"¿Quieres que te envíe el enlace para reservarla?\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    if lead.get("status") in ("new", "contacted_1", "contacted_2", "contacted_3",
                              "contacted_4", "contacted_5"):
        update_status(lead["id"], "in_conversation", author="agent_4")
    result = send_approved(lead, body, is_new_conversation=False,
                           advance_followup=False, wa=wa)
    return HandleResult("price_request", sent=result.success, message_sent=body)


def _handle_info_request(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    """Lead asked for broad info. Point them at the website and keep the
    conversation open without advancing any funnel state."""
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    if lang == "de":
        body = (
            f"Klar, {name}! 👋\n\n"
            f"Hier findest du alle Details zu unseren Kursen — Preise, "
            f"Methode, Lehrer:\n{WEBSITE_URL}\n\n"
            f"Wenn dir danach noch was unklar ist, frag mich einfach.\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    else:
        body = (
            f"¡Claro, {name}! 👋\n\n"
            f"Aquí tienes toda la info detallada de nuestros cursos — precios, "
            f"método, profesores:\n{WEBSITE_URL}\n\n"
            f"Si te queda alguna duda después de verla, pregúntame lo que quieras.\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    # Move to in_conversation so subsequent messages don't trigger cold outreach
    if lead.get("status") in ("new", "contacted_1", "contacted_2", "contacted_3",
                              "contacted_4", "contacted_5"):
        update_status(lead["id"], "in_conversation", author="agent_4")
    result = send_approved(lead, body, is_new_conversation=False,
                           advance_followup=False, wa=wa)
    return HandleResult("info_request", sent=result.success, message_sent=body)


def _handle_human_request(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    """Silent escalation: lead asked for a human → flag the conversation
    for Gelfis WITHOUT replying. Per Gelfis's spec, the lead does not
    see a "te paso con un compañero…" containment message anymore;
    Gelfis takes over from the inbox and the lead's next reply will
    come from a real person.

    `wa` is intentionally unused — kept in the signature to match the
    other handler shapes (the dispatch table calls them positionally).
    """
    del wa  # noqa: F841 — explicit no-op for the silent path
    update_status(lead["id"], "needs_human", author="agent_4")
    log_timeline(
        lead["id"],
        type="escalation",
        author="agent_4",
        content="Lead asked for human contact — silent escalation (Gelfis to take over).",
        metadata={"alert_gelfis": True, "silent": True},
    )
    return HandleResult("human_request", sent=False)


# ──────────────────────────────────────────────────────────
# ABSENT-FOLLOWUP positive reply (Gelfis 2026-06-17, caso Jhon)
# ──────────────────────────────────────────────────────────

# "Sí" puro, "si", "claro", "vale", "me interesa", "quiero", "ja",
# "natürlich", "klar", "ja gerne", "of course"... y variantes.
# Limitado al inicio del mensaje (^) o a una respuesta de hasta 30 chars
# para no matchear frases largas donde "si" es condicional ("si me
# das tiempo...").
_POSITIVE_RE_ES = re.compile(
    r"^(s[ií]+|claro|vale|me\s+interesa|quiero|por\s+supuesto|"
    r"por\s+favor|estoy\s+interesad[oa]|me\s+gustar[ií]a)"
    r"[\s\.\!\,\?\)\-:]*$",
    re.IGNORECASE,
)
_POSITIVE_RE_DE = re.compile(
    r"^(ja+|nat[üu]rlich|klar|gern(e)?|sicher|"
    r"ich\s+(habe\s+)?interesse|ich\s+m[öo]chte)"
    r"[\s\.\!\,\?\)\-:]*$",
    re.IGNORECASE,
)


def _looks_positive(text_norm: str, lang: str) -> bool:
    """True si el lead respondió algo positivo CORTO.
    Robusto contra falsos positivos (no matchea 'si me das tiempo'
    porque exige fin de mensaje tras la palabra)."""
    if not text_norm:
        return False
    # Limita a respuestas breves — frases largas suelen tener matices.
    if len(text_norm) > 60:
        return False
    pat = _POSITIVE_RE_DE if lang == "de" else _POSITIVE_RE_ES
    return bool(pat.match(text_norm.strip()))


def _handle_absent_followup_positive(
    lead: dict, wa: WhatsAppService | None,
) -> HandleResult:
    """Lead que no asistió respondió afirmativamente al "¿mantienes el
    interés?". Le mandamos el link self-serve y paramos la cadena
    absent_followup moviéndolo a in_conversation."""
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    book_url = f"{os.environ.get('PLATFORM_URL', 'https://b2c.aprender-aleman.de').rstrip('/')}/agendar/cuando"

    if lang == "de":
        body = (
            f"Super {name}! 🙌\n\n"
            f"Buch deine Deutsch-Probestunde in 3 Minuten: {book_url}\n\n"
            f"Sag mir Bescheid, wenn du gebucht hast.\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    else:
        body = (
            f"¡Genial {name}! 🙌\n\n"
            f"Agenda tu clase de alemán en 3 minutos: {book_url}\n\n"
            f"Avísame cuando agendes.\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )

    # Para la cadena absent_followup_* moviendo a in_conversation.
    # next_contact_date queda como esté — si el lead no agenda en
    # ~unos días, agent_0 puede volver a tocarlo desde el flow normal.
    update_status(lead["id"], "in_conversation", author="agent_4")
    log_timeline(
        lead["id"],
        type="agent_note",
        author="agent_4",
        content="✅ Lead respondió SI a absent_followup — link self-serve enviado, cadena absent_* parada",
        metadata={"kind": "absent_followup_positive_reply", "intent": "rebook"},
    )

    result = send_approved(lead, body, is_new_conversation=False, advance_followup=False, wa=wa)
    return HandleResult("absent_followup_positive", sent=result.success, message_sent=body)


# ──────────────────────────────────────────────────────────
# SUMMER PROMO reply handler (Gelfis 2026-06-23, silencioso)
# ──────────────────────────────────────────────────────────
# Estrategia: cualquier respuesta del lead que recibió summer_promo
# → silencio del bot + escalar a needs_human para que el equipo le
# atienda personalmente. El bot NO manda ack ni nada (Gelfis 2026-06-23).
# La cadena se cierra (step=4) para que el cron no le mande msg 2/3.


def _try_handle_summer_promo_reply(
    lead: dict, text: str, wa: WhatsAppService | None,
) -> HandleResult | None:
    """Lead que recibió summer_promo_msg respondió algo.
    Acciones (sin enviar nada al lead):
      - Cierra cadena (step=4, responded_at=NOW).
      - Cambia status a needs_human.
      - Log agent_note + notif in-app.
    """
    # Cierra cadena.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE leads SET summer_promo_step=4, summer_promo_responded_at=NOW() WHERE id=%s",
            (lead["id"],),
        )
    log_timeline(
        lead["id"],
        type="agent_note",
        author="agent_4",
        content=f"📨 Summer promo: lead respondió — escalado a needs_human (silencio bot). Reply: {text[:160]!r}",
        metadata={"kind": "summer_promo_reply", "reply": text[:300]},
    )
    update_status(lead["id"], "needs_human", author="agent_4")

    # sent=False porque NO mandamos nada al lead — solo escalación silenciosa.
    return HandleResult("summer_promo_reply_silenced", sent=False)


def _handle_negative(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    if lang == "de":
        body = (
            f"Alles klar, {name}. Ich schreibe dir nicht mehr.\n\n"
            f"Viel Erfolg weiterhin mit deinem Deutsch!\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    else:
        body = (
            f"Entendido, {name}. No te escribo más.\n\n"
            f"¡Mucho éxito con tu alemán!\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    update_status(lead["id"], "lost", author="agent_4")
    result = send_approved(lead, body, is_new_conversation=False, advance_followup=False, wa=wa)
    return HandleResult("negative", sent=result.success, message_sent=body)


def _handle_ai_reply(lead: dict, incoming: str, wa: WhatsAppService | None) -> HandleResult:
    # Transition to in_conversation on first AI reply.
    if lead.get("status") in ("new", "contacted_1", "contacted_2", "contacted_3", "contacted_4", "contacted_5"):
        update_status(lead["id"], "in_conversation", author="agent_4")

    draft = compose_reply(lead, incoming)
    if draft is None:
        # Agent 1 couldn't produce a reply — escalate to Gelfis.
        update_status(lead["id"], "needs_human", author="agent_4")
        log_timeline(
            lead["id"], type="escalation", author="agent_4",
            content="Agent 1 returned no draft — escalated to Gelfis.",
            metadata={"alert_gelfis": True, "incoming_text": incoming[:300]},
        )
        return HandleResult("ai_reply", sent=False)

    review = review_single(lead, draft)
    if not review.approved:
        log_timeline(
            lead["id"], type="agent_note", author="agent_2",
            content=f"Rejected AI reply draft: {review.reason}",
            metadata={"draft": draft.text[:500], "incoming": incoming[:300]},
        )
        # One retry: ask Agent 1 for a fresh draft. If that also fails,
        # escalate (spec: max 2 correction cycles).
        draft2 = compose_reply(lead, incoming)
        if draft2 is None or not review_single(lead, draft2).approved:
            update_status(lead["id"], "needs_human", author="agent_4")
            log_timeline(
                lead["id"], type="escalation", author="agent_4",
                content="Agent 2 rejected draft twice — escalated to Gelfis.",
                metadata={"alert_gelfis": True, "incoming_text": incoming[:300]},
            )
            return HandleResult("ai_reply", sent=False)
        draft = draft2

    result = send_approved(lead, draft.text, is_new_conversation=False, advance_followup=False, wa=wa)
    return HandleResult("ai_reply", sent=result.success, message_sent=draft.text)
