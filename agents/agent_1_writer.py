# Touch: 2026-05-12 — verificar auto-deploy cron en VPS.
"""
Agent 1 — MESSAGE WRITER (El Redactor).

Hybrid:
  * Contact 1 & 2  → templates (zero API cost).
  * Contact 3+ and conversation replies → AI (Sonnet 4.6).

Public surface:

    compose_message(lead)          -> MessageDraft | None   (outbound initiative)
    compose_reply(lead, incoming)  -> MessageDraft | None   (reply to a lead msg)

MessageDraft.kind lets Agent 2 decide whether to auto-approve (templates) or
route through the LLM reviewer (anything with uses_ai=True).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from agents.shared.claude_client import (
    BRAND_CONTEXT,
    MODEL_HAIKU,
    complete_text,
)
from agents.shared.leads import get_gelfis_notes, get_recent_timeline

log = logging.getLogger("agent_1")


@dataclass
class MessageDraft:
    text: str
    kind: str
    language: str
    uses_ai: bool = False


# ──────────────────────────────────────────────────────────
# Templates (contacts 1 & 2)
# ──────────────────────────────────────────────────────────

GOAL_CONTEXT_ES = {
    "work":             "tu meta de trabajar en Alemania",
    "visa":             "que obtengas tu visa",
    "studies":          "que entres a la universidad alemana",
    "exam":             "que apruebes tu examen oficial",
    "travel":           "que te puedas comunicar sin problemas",
    "already_in_dach":  "que domines el alemán en tu día a día",
}
GOAL_CONTEXT_DE = {
    "work":             "deinen Job in Deutschland oder der Schweiz",
    "visa":             "deinen Visumsantrag",
    "studies":          "dein Uni-Ziel",
    "exam":             "deine offizielle Prüfung",
    "travel":           "sicheres Kommunizieren auf Deutsch",
    "already_in_dach":  "deinen Alltag in DACH",
}


def _first_name(lead: dict) -> str:
    return (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""


def _goal_context(lead: dict) -> str:
    table = GOAL_CONTEXT_DE if lead["language"] == "de" else GOAL_CONTEXT_ES
    return table.get(lead["goal"], table["work"])


SIGN_OFF_ES = "\n\n— Stiv · Aprender-Aleman.de"
SIGN_OFF_DE = "\n\n— Stiv · Aprender-Aleman.de"


def _template_contact_1(lead: dict) -> str:
    """
    Primer contacto a leads que se registraron en el funnel pero NO
    agendaron clase de prueba. Decisión Gelfis 2026-05-12: ofrecemos
    una llamada de 15 min (no clase de prueba) — la llamada convierte
    mejor con leads que se quedaron parados en el funnel.
    Firma: Stiv · Aprender-Aleman.de.
    """
    name = _first_name(lead)
    if lead["language"] == "de":
        return (
            f"Hallo {name}!\n\n"
            f"Schön dich zu kennen — ich bin Stiv von der Akademie "
            f"Aprender-Aleman.de. 👋\n\n"
            f"Wir haben dein Interesse, Deutsch zu lernen, erhalten. Hättest "
            f"du Lust, 15 Minuten zu sprechen, damit ich dir erkläre, wie wir "
            f"dir dabei helfen können?\n\n"
            f"Wann passt es dir, dass ich dich heute oder morgen anrufe?"
            + SIGN_OFF_DE
        )
    return (
        f"¡Hola {name}!\n\n"
        f"Es un gusto saludarte, soy Stiv de la academia "
        f"Aprender-Aleman.de. 👋\n\n"
        f"Recibimos tu interés para aprender alemán. ¿Te parece si hablamos "
        f"15 minutos para contarte cómo podemos ayudarte a lograrlo?\n\n"
        f"¿A qué hora te vendría bien que te llame hoy o mañana?"
        + SIGN_OFF_ES
    )


def _template_contact_2(lead: dict) -> str:
    name = _first_name(lead)
    if lead["language"] == "de":
        return (
            f"Hallo {name}, hast du meine Nachricht von gestern gesehen? 😊\n\n"
            f"Ich schreibe dir, falls du gerne einen Termin für die kostenlose "
            f"Probestunde vereinbaren möchtest.\n\n"
            f"Ganz unverbindlich."
            + SIGN_OFF_DE
        )
    return (
        f"Hola {name}, ¿viste mi mensaje de ayer? 😊\n\n"
        f"Te escribo por si quieres que agendemos la clase de prueba gratuita.\n\n"
        f"Es sin compromiso."
        + SIGN_OFF_ES
    )


# ──────────────────────────────────────────────────────────
# AI layer (contacts 3+ and conversation replies)
# ──────────────────────────────────────────────────────────

_REENGAGEMENT_SYSTEM = BRAND_CONTEXT + """

TASK: Write a brief follow-up WhatsApp message to a lead who has NOT replied
to previous outreach. You are trying to re-engage them — kindly, not pushy.

HARD LIMITS (a stricter reviewer will reject anything that breaks these):
  - MAX 400 characters total including the signature.
  - MAX 3 short paragraphs separated by blank lines (one \\n\\n between each).
    Every message has the shape:

        greeting / hook

        main point

        — Stiv · Aprender-Aleman.de

  - NO bullet lists.
  - NO Calendly link unless the lead already asked to book.

TONE rules:
  - Acknowledge time has passed without guilt-tripping.
  - Offer ONE thing: either answer a question OR invite to book. Not both.
  - At contact 3, you may briefly mention SCHULE (free platform). ONE sentence.
  - At contact 4, you may briefly mention Hans (AI professor 24/7). ONE sentence.
  - At contact 5 (final), make it clear this is the last message — still warm.

Output MUST be only the message text. No preamble, no markdown, no code fences.
"""

_CONVERSATION_SYSTEM = BRAND_CONTEXT + """

TASK: Write a brief WhatsApp reply to a lead's incoming message.

Rules specific to this task:
  - Read the conversation context carefully, then answer the actual question.
  - **Short and direct: 2-4 short paragraphs, each separated by a blank
    line (\\n\\n).** No dense walls of text.
  - If the lead clearly wants to book, say so — Agent 3 attaches the
    Calendly link on approval.
  - If the lead asks for broad info (prices, full curriculum, teachers,
    methodology), point them to https://aprender-aleman.de and invite
    them to ask anything specific after visiting.
  - If the lead asks something you genuinely don't know (a specific
    teacher by name, a custom schedule not in your facts), say honestly
    you'll check with the team — this routes to human handoff.
  - End with the signature line:

        — Stiv · Aprender-Aleman.de

  - Output MUST be only the message text, no preamble, no markdown.
"""


def _contact_number_hint(followup_number: int) -> str:
    return {
        2: "This will be contact #3 overall — you may mention SCHULE once if relevant.",
        3: "This will be contact #4 overall — you may mention Hans (AI professor) if relevant.",
        4: "This will be contact #5 — FINAL message. Make it clear it's the last attempt.",
    }.get(followup_number, "")


def _format_timeline(tl: list[dict], limit: int = 10) -> str:
    """Compact recent timeline, newest first, for model context."""
    out: list[str] = []
    for entry in tl[:limit]:
        ts = entry["timestamp"].strftime("%Y-%m-%d %H:%M")
        author = entry["author"]
        etype = entry["type"]
        body = (entry["content"] or "")[:300].replace("\n", " ")
        out.append(f"[{ts}] {author}/{etype}: {body}")
    return "\n".join(out) if out else "(no prior events)"


def _format_notes(notes: list[dict]) -> str:
    if not notes:
        return "(no Gelfis notes)"
    return "\n".join(
        f"- [{n['created_at'].strftime('%Y-%m-%d')}] {n['note']}"
        for n in notes[:5]
    )


def _compose_ai_reengagement(lead: dict) -> MessageDraft | None:
    timeline = get_recent_timeline(lead["id"], limit=10)
    notes    = get_gelfis_notes(lead["id"], limit=5)
    fu_num   = int(lead.get("current_followup_number") or 0)

    user_prompt = f"""\
LEAD PROFILE
  - name: {lead.get('name')}
  - language: {lead.get('language')}
  - German level: {lead.get('german_level')}
  - goal: {lead.get('goal')}
  - urgency: {lead.get('urgency')}
  - status: {lead.get('status')}
  - previous contacts sent: {fu_num}

{_contact_number_hint(fu_num)}

RECENT TIMELINE (newest first)
{_format_timeline(timeline)}

GELFIS NOTES
{_format_notes(notes)}

Write the next follow-up message now, in {lead['language']}.
"""

    text, _ = complete_text(
        model=MODEL_HAIKU,
        system=_REENGAGEMENT_SYSTEM,
        user=user_prompt,
        max_tokens=250,
    )
    if not text:
        return None
    return MessageDraft(
        text=text,
        kind=f"ai_contact_{fu_num + 1}",
        language=lead["language"],
        uses_ai=True,
    )


def _detect_recent_admin_takeover(timeline: list[dict]) -> bool:
    """
    Devuelve True si en los últimos 14 días el admin ha hecho un takeover
    (pause + reactivate) sobre este lead. Cuando es True, el writer
    eleva la atención del LLM a las gelfis_notes para no repetir info.
    Decisión Gelfis 2026-05-04 tras incidente Asmaa.
    """
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    for e in timeline:
        ts = e.get("timestamp")
        if not ts or ts < cutoff:
            continue
        if e.get("type") == "agent_note" and e.get("author") == "admin":
            content = (e.get("content") or "").lower()
            if "stiv reactivado" in content or "tomo la conversación" in content:
                return True
    return False


def compose_reply(lead: dict, incoming_text: str) -> MessageDraft | None:
    """
    Compose a reply to a lead's incoming message. Called by Agent 4 after
    the keyword layer fails to find a direct match.
    """
    # Pillamos timeline más largo para detectar takeover ↓ (limit=15) y
    # luego cortamos al renderizar (limit=5).
    timeline = get_recent_timeline(lead["id"], limit=15)
    notes    = get_gelfis_notes(lead["id"], limit=5)
    recent_takeover = _detect_recent_admin_takeover(timeline)

    takeover_warning = ""
    if recent_takeover:
        takeover_warning = (
            "⚠️ TAKEOVER RECIENTE — el admin manejó este lead "
            "manualmente hace poco y dejó nota(s) en GELFIS NOTES. "
            "LEE las notas con atención antes de responder. NO repitas "
            "información que el admin ya trató. Si la nota dice algo "
            "como 'le dije que reagendamos para X' o 'le envié el link', "
            "asume que eso ya está hecho y continúa desde ahí.\n\n"
        )

    user_prompt = f"""\
{takeover_warning}LEAD PROFILE
  - name: {lead.get('name')}
  - language: {lead.get('language')}
  - German level: {lead.get('german_level')}
  - goal: {lead.get('goal')}
  - urgency: {lead.get('urgency')}
  - status: {lead.get('status')}

RECENT CONVERSATION (newest first, last 5 entries only)
{_format_timeline(timeline, limit=5)}

GELFIS NOTES
{_format_notes(notes)}

THE LEAD JUST WROTE
"{incoming_text}"

Write the reply now, in {lead['language']}.
"""
    text, _ = complete_text(
        model=MODEL_HAIKU,
        system=_CONVERSATION_SYSTEM,
        user=user_prompt,
        max_tokens=250,
    )
    if not text:
        return None
    return MessageDraft(
        text=text,
        kind="ai_conversation_reply",
        language=lead["language"],
        uses_ai=True,
    )


# ──────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────


def compose_message(lead: dict) -> MessageDraft | None:
    """Decide what outbound message (if any) to compose for this lead."""
    status = lead["status"]
    lang = lead["language"]
    rc = int(lead.get("reactivation_count") or 0)

    if status == "new":
        return MessageDraft(
            text=_template_contact_1(lead),
            kind="template_contact_1",
            language=lang,
        )
    if status == "contacted_1":
        return MessageDraft(
            text=_template_contact_2(lead),
            kind="template_contact_2",
            language=lang,
        )
    if status in ("contacted_2", "contacted_3", "contacted_4"):
        return _compose_ai_reengagement(lead)

    # Post-engagement reactivations (migración 041 + política Gelfis 2026-04-29).
    if status == "link_sent" and rc < 2:
        return MessageDraft(
            text=_template_link_reminder(lead, rc),
            kind=f"template_link_reminder_{rc + 1}",
            language=lang,
        )
    if status == "in_conversation" and rc < 1:
        # FIX bug Saul 2026-06-13: tras marcar attended/absent un trial,
        # status pasa a in_conversation y next_contact_date al instante,
        # provocando que el cron Python dispare un revival ("¿quedó alguna
        # duda?") que no tiene sentido tras una clase de prueba. Si hubo
        # cualquier evento de trial en las ultimas 6h, saltamos el revival
        # — el flujo natural es: post_trial_followup (TS) lleva el link de
        # pago, no necesita revival.
        if _had_recent_trial_event(lead["id"], hours=6):
            return None
        return MessageDraft(
            text=_template_conversation_revive(lead),
            kind="template_conversation_revive",
            language=lang,
        )

    return None


def _had_recent_trial_event(lead_id: str, hours: int = 6) -> bool:
    """True si en las ultimas N horas hubo un status_change que marca
    asistencia (attended) o ausencia (did not attend) de trial.
    Cubre tanto 'Lead attended trial' como 'Lead did not attend trial'
    (este ultimo matchea 'attended trial' tambien por sustring)."""
    from agents.shared.db import get_conn
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM lead_timeline
             WHERE lead_id = %s
               AND type = 'status_change'
               AND content ILIKE '%%attended trial%%'
               AND timestamp > NOW() - (%s * INTERVAL '1 hour')
             LIMIT 1
            """,
            (lead_id, hours),
        )
        return cur.fetchone() is not None


# ──────────────────────────────────────────────────────────
# Templates de reactivación (post-engagement)
# ──────────────────────────────────────────────────────────


_FUNNEL_URL = "https://b2c.aprender-aleman.de/agendar"


def _template_link_reminder(lead: dict, reactivation_count: int) -> str:
    """Recordatorio para leads en status='link_sent' que no booketron tras
    enviarles el link.

    reactivation_count == 0 → primer recordatorio (+24h tras link_sent).
    reactivation_count == 1 → último recordatorio (+5d después). Tras
                              enviar este, el sistema marca al lead como cold.
    """
    name = _first_name(lead)
    de   = lead["language"] == "de"

    if reactivation_count == 0:
        if de:
            return (
                f"Hallo {name} 👋\n\n"
                f"Hat alles geklappt mit der Buchung? Falls etwas nicht funktioniert "
                f"hat oder du noch eine Frage hattest, schreib mir kurz.\n\n"
                f"Hier ist der Link nochmal:\n{_FUNNEL_URL}\n\n"
                f"{SIGN_OFF_DE.lstrip()}"
            )
        return (
            f"Hola {name} 👋\n\n"
            f"¿Pudiste agendar tu clase de prueba? Si tuviste algún problema o "
            f"te quedó alguna duda, dímelo y te ayudo.\n\n"
            f"Te paso el link otra vez:\n{_FUNNEL_URL}\n\n"
            f"{SIGN_OFF_ES.lstrip()}"
        )

    # reactivation_count == 1 — último intento
    if de:
        return (
            f"Hallo {name},\n\n"
            f"Letzte Erinnerung von mir 🙂. Falls du noch Lust auf die "
            f"kostenlose Probestunde hast, hier der Link:\n{_FUNNEL_URL}\n\n"
            f"Sonst alles Gute für dich.\n\n"
            f"{SIGN_OFF_DE.lstrip()}"
        )
    return (
        f"Hola {name},\n\n"
        f"Último recordatorio de mi parte 🙂. Si aún quieres tu clase de prueba "
        f"gratis, aquí va el link:\n{_FUNNEL_URL}\n\n"
        f"Si no, te deseo lo mejor.\n\n"
        f"{SIGN_OFF_ES.lstrip()}"
    )


def _template_conversation_revive(lead: dict) -> str:
    """Reactivación para leads en status='in_conversation' que se quedaron
    callados tras una respuesta del bot. Solo se envía 1 vez (rc=0). Si
    no responden tras esto, el sistema los marca cold.
    """
    name = _first_name(lead)
    if lead["language"] == "de":
        return (
            f"Hallo {name}, alles gut bei dir? 😊\n\n"
            f"Ich wollte nur kurz nachfragen — gibt es noch etwas, das ich klären "
            f"kann, oder ist es gerade nicht der richtige Moment?\n\n"
            f"Schreib mir, wann du willst.\n\n"
            f"{SIGN_OFF_DE.lstrip()}"
        )
    return (
        f"Hola {name}, ¿todo bien? 😊\n\n"
        f"Te escribo solo para chequear — ¿quedó alguna duda que pueda resolverte, "
        f"o simplemente no es el momento?\n\n"
        f"Cuando quieras, escríbeme.\n\n"
        f"{SIGN_OFF_ES.lstrip()}"
    )
