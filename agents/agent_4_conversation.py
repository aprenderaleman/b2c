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
import re
from dataclasses import dataclass
from typing import Literal

from agents.agent_1_writer import MessageDraft, compose_reply
from agents.agent_2_reviewer import review_single
from agents.agent_3_sender import send_approved
from agents.shared.db import get_config
from agents.shared.leads import log_timeline, update_status
from agents.whatsapp_service import WhatsAppService

log = logging.getLogger("agent_4")


# ──────────────────────────────────────────────────────────
# Keyword tables (match on word boundaries, case-insensitive)
# ──────────────────────────────────────────────────────────

BOOKING_WORDS = {
    "es": [
        "si", "sí", "claro", "ok", "okey", "vale", "dale", "quiero",
        "agendar", "agéndame", "agendame", "envíame", "enviame",
        "mándame", "mandame", "manda", "enlace", "link", "reservar",
        "reserva", "reservame", "book", "booking",
    ],
    "de": [
        "ja", "klar", "gerne", "okay", "ok", "schick", "schicken",
        "buchen", "termin", "link", "buche", "schick mir",
    ],
}

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
        "no me escriban más", "no me escriban mas",
        "dejen de escribirme", "dejen de escribir",
        "no me interesa", "cancelar", "cancela",
        "borrar", "borra mis datos", "basta", "stop",
        "quiten mi número", "quiten mi numero",
    ],
    "de": [
        "bitte nicht mehr schreiben", "nicht mehr schreiben",
        "abmelden", "kein interesse",
        "nicht interessiert", "stopp", "stop",
        "meine daten löschen",
    ],
}

# "Broad info request" — when the lead wants details beyond what we'd send
# conversationally (prices, curriculum, teachers…). We reply with the
# public website URL in one short message.
INFO_WORDS = {
    "es": [
        "más info", "mas info", "más información", "mas informacion",
        "informacion", "información", "detalles", "precios", "precio",
        "cuanto cuesta", "cuánto cuesta", "pagina web", "página web",
        "sitio web", "la web", "ver web", "ver la web",
    ],
    "de": [
        "mehr info", "mehr infos", "mehr informationen", "details",
        "preis", "preise", "webseite", "website", "homepage",
    ],
}

CALENDLY_URL = "https://calendly.com/d/cxf3-s6q-76f/sesion-de-prueba-de-aleman"
WEBSITE_URL  = "https://aprender-aleman.de"


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
    "booking", "human_request", "negative", "info_request", "ai_reply",
    "already_converted_ignore", "needs_human_already_paused_ignore",
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

    # Once converted, NEVER auto-reply (spec).
    if status == "converted":
        log.info("Lead %s converted — ignoring inbound.", lead["id"])
        return HandleResult("already_converted_ignore", sent=False)

    # If paused for human, do not auto-reply.
    if status == "needs_human":
        log.info("Lead %s in needs_human — holding.", lead["id"])
        return HandleResult("needs_human_already_paused_ignore", sent=False)

    text_norm = _norm(text)
    other_lang = "es" if lang == "de" else "de"

    # LAYER 1 — keywords (zero AI cost).  Order matters: negative first so
    # "no quiero más info" wins over the "info" keyword; human request next;
    # then booking; then broad-info request.
    if _has_phrase(text_norm, NEGATIVE_WORDS[lang] + NEGATIVE_WORDS[other_lang]):
        return _handle_negative(lead, wa)

    if _has_phrase(text_norm, HUMAN_WORDS[lang] + HUMAN_WORDS[other_lang]):
        return _handle_human_request(lead, wa)

    if _has_phrase(text_norm, BOOKING_WORDS[lang]):
        return _handle_booking(lead, wa)

    if _has_phrase(text_norm, INFO_WORDS[lang] + INFO_WORDS[other_lang]):
        return _handle_info_request(lead, wa)

    # LAYER 2 — AI reply
    return _handle_ai_reply(lead, text, wa)


# ──────────────────────────────────────────────────────────
# Handlers
# ──────────────────────────────────────────────────────────


def _handle_booking(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    if lang == "de":
        body = (
            f"Super, {name}! 🎉\n\n"
            f"Hier ist der Link, um deinen Termin für die kostenlose Probestunde "
            f"zu wählen:\n{CALENDLY_URL}\n\n"
            f"Sag mir Bescheid, wenn du Hilfe brauchst.\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
    else:
        body = (
            f"¡Genial, {name}! 🎉\n\n"
            f"Aquí tienes el enlace para elegir el horario de tu clase de prueba "
            f"gratuita:\n{CALENDLY_URL}\n\n"
            f"Dime si necesitas ayuda para elegir el horario.\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
    update_status(lead["id"], "link_sent", author="agent_4")
    result = send_approved(lead, body, is_new_conversation=False, advance_followup=False, wa=wa)
    return HandleResult("booking", sent=result.success, message_sent=body)


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
            f"Stiv, Aprender-Aleman.de"
        )
    else:
        body = (
            f"¡Claro, {name}! 👋\n\n"
            f"Aquí tienes toda la info detallada de nuestros cursos — precios, "
            f"método, profesores:\n{WEBSITE_URL}\n\n"
            f"Si te queda alguna duda después de verla, pregúntame lo que quieras.\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
    # Move to in_conversation so subsequent messages don't trigger cold outreach
    if lead.get("status") in ("new", "contacted_1", "contacted_2", "contacted_3",
                              "contacted_4", "contacted_5"):
        update_status(lead["id"], "in_conversation", author="agent_4")
    result = send_approved(lead, body, is_new_conversation=False,
                           advance_followup=False, wa=wa)
    return HandleResult("info_request", sent=result.success, message_sent=body)


def _handle_human_request(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    """Escalate — containment message, then pause lead completely."""
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    if lang == "de":
        body = (
            f"Klar, {name}! 😊\n\n"
            f"Ich leite dich direkt an Gelfis weiter. Er meldet sich in den "
            f"nächsten Stunden persönlich bei dir.\n\n"
            f"In der Zwischenzeit kannst du schon kostenlos auf SCHULE üben:\n"
            f"https://schule.aprender-aleman.de\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
    else:
        body = (
            f"¡Claro, {name}! 😊\n\n"
            f"Voy a transferirte con Gelfis directamente. Él te contactará "
            f"personalmente en las próximas horas.\n\n"
            f"Mientras tanto, si quieres, practica gratis en SCHULE:\n"
            f"https://schule.aprender-aleman.de\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
    update_status(lead["id"], "needs_human", author="agent_4")
    log_timeline(
        lead["id"],
        type="escalation",
        author="agent_4",
        content="Lead asked for human contact — paused for Gelfis.",
        metadata={"alert_gelfis": True},
    )
    result = send_approved(lead, body, is_new_conversation=False, advance_followup=False, wa=wa)
    return HandleResult("human_request", sent=result.success, message_sent=body)


def _handle_negative(lead: dict, wa: WhatsAppService | None) -> HandleResult:
    lang = lead.get("language", "es")
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    if lang == "de":
        body = (
            f"Alles klar, {name}. Ich schreibe dir nicht mehr.\n\n"
            f"Viel Erfolg weiterhin mit deinem Deutsch!\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
    else:
        body = (
            f"Entendido, {name}. No te escribo más.\n\n"
            f"¡Mucho éxito con tu alemán!\n\n"
            f"Stiv, Aprender-Aleman.de"
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
