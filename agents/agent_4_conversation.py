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

from datetime import datetime

from agents.agent_1_writer import MessageDraft, compose_reply
from agents.agent_2_reviewer import review_single
from agents.agent_3_sender import send_approved
from agents.shared.db import get_config, get_conn
from agents.shared.leads import log_timeline, update_status
from agents.shared.rate_limits import BERLIN
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


def _fetch_top_trial_slots(top: int = 3) -> list[dict]:
    """Hit the public /api/public/trial-slots endpoint and return the
    first `top` results. We pick the public endpoint over a private
    one because there's no point gating data the funnel already
    exposes anonymously, and it keeps the agent → web wiring trivial.

    Returns an empty list on any failure — caller handles the
    "couldn't fetch" copy gracefully.
    """
    import httpx
    try:
        r = httpx.get(f"{WEB_BASE}/api/public/trial-slots", timeout=8.0)
        r.raise_for_status()
        data = r.json()
        slots = data.get("slots") or []
        return slots[:top]
    except Exception as e:  # noqa: BLE001
        log.warning("Failed to fetch trial slots: %s", e)
        return []


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

    # Once converted, NEVER auto-reply (spec).
    if status == "converted":
        log.info("Lead %s converted — ignoring inbound.", lead["id"])
        return HandleResult("already_converted_ignore", sent=False)

    # If paused for human, do not auto-reply.
    if status == "needs_human":
        log.info("Lead %s in needs_human — holding.", lead["id"])
        return HandleResult("needs_human_already_paused_ignore", sent=False)

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

    text_norm = _norm(text)
    other_lang = "es" if lang == "de" else "de"

    # NEGATIVE / HUMAN-request still win over the trial-already-booked branch:
    # someone who asks to unsubscribe or asks for a human deserves the right
    # response regardless of their booking state.
    if _has_phrase(text_norm, NEGATIVE_WORDS[lang] + NEGATIVE_WORDS[other_lang]):
        return _handle_negative(lead, wa)

    if _has_phrase(text_norm, HUMAN_WORDS[lang] + HUMAN_WORDS[other_lang]):
        return _handle_human_request(lead, wa)

    # TRIAL ALREADY BOOKED — if the lead already has a scheduled trial,
    # NEVER push them to book again. Recognise the state and respond with
    # the booking details, plus a soft prompt asking what they need. This
    # catches both the self-book funnel path AND the legacy WhatsApp path
    # once the lead has reserved.
    if status in ("trial_scheduled", "trial_reminded"):
        return _handle_trial_already_booked(lead, text, wa)

    # LAYER 1 — keywords (zero AI cost). Order matters: info-call wins
    # over booking ("quiero una llamada" mustn't fire booking on "quiero").
    if _has_phrase(text_norm, INFO_CALL_WORDS[lang] + INFO_CALL_WORDS[other_lang]):
        return _handle_info_call_request(lead, wa)

    if _has_phrase(text_norm, BOOKING_WORDS[lang]):
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


def _format_trial_when(dt: datetime | None, lang: str) -> str:
    if not dt:
        return "pronto" if lang == "es" else "bald"
    local = dt.astimezone(BERLIN) if dt.tzinfo else BERLIN.localize(dt)
    if lang == "de":
        return local.strftime("%A, %d.%m.%Y um %H:%M") + " (Berlin)"
    # Spanish — capitalise weekday so it reads naturally mid-sentence.
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
    """Lead already has a trial scheduled. Don't push booking — surface the
    details and offer to help. We let the AI handle the substantive reply
    (so the lead's actual question gets answered), but anchor it with the
    booking facts so the model never invents a different time/teacher.
    """
    name = (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""
    lang = lead.get("language", "es")
    when_dt, teacher_name = _trial_class_details(lead["id"])
    when_str = _format_trial_when(when_dt, lang)

    # Compose a reply through Agent 1 + Agent 2 with the booking facts as
    # extra context. If the AI can't produce a good reply, fall back to a
    # static acknowledgement with the booking details.
    facts_es = (
        f"[CONTEXTO INTERNO — NO REPETIR LITERAL]\n"
        f"Este lead YA TIENE clase de prueba reservada: {when_str}"
        f"{' con ' + teacher_name if teacher_name else ''}.\n"
        f"NO le ofrezcas reservar otra clase. Si pregunta por la fecha o el profesor, "
        f"confírmaselos. Responde brevemente a su mensaje actual."
    )
    facts_de = (
        f"[INTERNER KONTEXT — NICHT WÖRTLICH WIEDERHOLEN]\n"
        f"Dieser Lead hat BEREITS eine Probestunde gebucht: {when_str}"
        f"{' mit ' + teacher_name if teacher_name else ''}.\n"
        f"BIETE KEINE neue Buchung an. Wenn er nach Datum/Lehrer fragt, "
        f"bestätige sie. Antworte kurz auf seine aktuelle Nachricht."
    )
    facts = facts_de if lang == "de" else facts_es
    augmented = f"{facts}\n\n[MENSAJE DEL LEAD]\n{incoming}"

    draft = compose_reply(lead, augmented)
    if draft is None or not review_single(lead, draft).approved:
        # Static fallback — confirms the class without sounding like a bot.
        if lang == "de":
            body = (
                f"Hallo {name}! 👋\n\n"
                f"Du hast deine Probestunde am {when_str}"
                f"{' mit ' + teacher_name if teacher_name else ''}.\n\n"
                f"Wie kann ich dir helfen?\n\n"
                f"— Stiv · Aprender-Aleman.de"
            )
        else:
            body = (
                f"¡Hola {name}! 👋\n\n"
                f"Tu clase de prueba es el {when_str}"
                f"{' con ' + teacher_name if teacher_name else ''}.\n\n"
                f"¿En qué te puedo ayudar?\n\n"
                f"— Stiv · Aprender-Aleman.de"
            )
    else:
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
