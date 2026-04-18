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
    MODEL_SONNET,
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


SIGN_OFF_ES = "\n\nStiv, Aprender-Aleman.de"
SIGN_OFF_DE = "\n\nStiv, Aprender-Aleman.de"


def _template_contact_1(lead: dict) -> str:
    name, ctx = _first_name(lead), _goal_context(lead)
    if lead["language"] == "de":
        return (
            f"Hallo {name}! 👋\n\n"
            f"Ich bin Stiv von Aprender-Aleman.de — wir haben deine Anfrage erhalten.\n\n"
            f"Wir würden dich gerne zu einer *kostenlosen Probestunde* einladen, "
            f"um dein Niveau zu prüfen und einen persönlichen Plan für {ctx} zu erstellen.\n\n"
            f"Soll ich dir den Link zum Terminbuchen schicken?"
            + SIGN_OFF_DE
        )
    return (
        f"¡Hola {name}! 👋\n\n"
        f"Soy Stiv de Aprender-Aleman.de — recibimos tu solicitud.\n\n"
        f"Nos gustaría invitarte a una *clase de prueba gratuita* para conocer tu nivel "
        f"y diseñarte un plan personalizado para {ctx}.\n\n"
        f"¿Te envío el enlace para que elijas el horario que mejor te venga?"
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

        Stiv, Aprender-Aleman.de

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

        Stiv, Aprender-Aleman.de

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
        model=MODEL_SONNET,
        system=_REENGAGEMENT_SYSTEM,
        user=user_prompt,
        max_tokens=400,
    )
    if not text:
        return None
    return MessageDraft(
        text=text,
        kind=f"ai_contact_{fu_num + 1}",
        language=lead["language"],
        uses_ai=True,
    )


def compose_reply(lead: dict, incoming_text: str) -> MessageDraft | None:
    """
    Compose a reply to a lead's incoming message. Called by Agent 4 after
    the keyword layer fails to find a direct match.
    """
    timeline = get_recent_timeline(lead["id"], limit=5)
    notes    = get_gelfis_notes(lead["id"], limit=3)

    user_prompt = f"""\
LEAD PROFILE
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
        model=MODEL_SONNET,
        system=_CONVERSATION_SYSTEM,
        user=user_prompt,
        max_tokens=400,
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

    return None
