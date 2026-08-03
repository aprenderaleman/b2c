"""
Agent 5 — GUARDIAN AGENT (post-trial conversion monitor).

Event-driven, mostly pure code. Calendly used to live here too but the
self-book funnel replaced it; the only relevant trigger now is the
dashboard state machine (welcome / goodbye).

Triggers:
  * Dashboard actions: mark_attended_converted / mark_attended_lost / mark_absent

Pre-class reminders are owned by the web side now:
  * /api/cron/trial-reminders-24h    — 24h-before email (lead + teacher)
  * /api/cron/trial-reminders-morning — 8 AM same-day email (lead + teacher)
  * scheduler._notify_trials_30min   — 30-min-before WhatsApp (lead + teacher)

Absent follow-ups: la cadena legacy tick_absent_followups (4 mensajes
D+1/D+3/D+5/D+7) fue ELIMINADA (Gelfis 2026-08-01). Ahora el flujo es:
  1. markTrialAbsent (TS admin-actions) manda 1 solo WA/email
     "¿sigues teniendo interés real? SÍ/NO" (flow absent-interest).
  2. reschedule_flow.py detecta la respuesta y actúa.
Sin cadena adicional — reduce mensajes al lead y evita duplicados.

Public surface:

    mark_attended_converted(lead_id)
    mark_attended_lost(lead_id, reason)
    mark_absent(lead_id)
"""
from __future__ import annotations

import logging

from agents.agent_3_sender import send_approved
from agents.shared.leads import get_lead, log_timeline, update_status

log = logging.getLogger("agent_5")


# ──────────────────────────────────────────────────────────
# Outbound messages (welcome / goodbye / absent-followup)
# ──────────────────────────────────────────────────────────


def _first_name(lead: dict) -> str:
    return (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""


def _send_welcome_message(lead: dict) -> None:
    name = _first_name(lead)
    if lead["language"] == "de":
        body = (
            f"Willkommen bei Aprender-Aleman.de, {name}! 🎉\n\n"
            f"Wir freuen uns sehr, dass du dabei bist.\n\n"
            f"Während du auf deine Stunden wartest, kannst du schon kostenlos auf "
            f"SCHULE üben — unserem virtuellen Klassenzimmer:\n"
            f"https://schule.aprender-aleman.de\n\n"
            f"Offiziell willkommen in der Akademie. 🇩🇪\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    else:
        body = (
            f"¡Bienvenido a Aprender-Aleman.de, {name}! 🎉\n\n"
            f"Estamos felices de tenerte con nosotros.\n\n"
            f"Mientras esperas tus clases, ya puedes acceder a SCHULE, nuestra "
            f"aula virtual gratuita:\n"
            f"https://schule.aprender-aleman.de\n\n"
            f"Bienvenido oficialmente a la Academia. 🇩🇪\n\n"
            f"— Stiv · Aprender-Aleman.de"
        )
    send_approved(lead, body, is_new_conversation=False, advance_followup=False)


def _send_goodbye(lead: dict) -> None:
    name = _first_name(lead)
    if lead["language"] == "de":
        body = f"Alles Gute, {name}. 🧡\n\n— Stiv · Aprender-Aleman.de"
    else:
        body = f"Te deseamos lo mejor, {name}. 🧡\n\n— Stiv · Aprender-Aleman.de"
    send_approved(lead, body, is_new_conversation=False, advance_followup=False)


# ──────────────────────────────────────────────────────────
# Dashboard-triggered transitions
# ──────────────────────────────────────────────────────────


def mark_attended_converted(lead_id: str) -> None:
    lead = get_lead(lead_id)
    if not lead:
        return
    update_status(lead_id, "converted", author="gelfis")
    log_timeline(
        lead_id, type="conversion", author="gelfis",
        content="Payment confirmed — lead converted.",
    )
    _send_welcome_message(lead)


def mark_attended_lost(lead_id: str, reason: str) -> None:
    lead = get_lead(lead_id)
    if not lead:
        return
    update_status(lead_id, "lost", author="gelfis")
    log_timeline(
        lead_id, type="status_change", author="gelfis",
        content=f"Attended but lost: {reason[:300]}",
    )
    _send_goodbye(lead)


def mark_absent(lead_id: str) -> None:
    """Marca el lead como trial_absent SIN activar cadena legacy.

    Fix Gelfis 2026-08-01: la cadena tick_absent_followups (4 mensajes)
    fue eliminada. Este handler ya no setea next_contact_date — el flow
    real es el TS markTrialAbsent que manda 1 solo WA "¿sigues teniendo
    interés? SÍ/NO" y espera respuesta. Esta función Python queda como
    compat para callers antiguos y para el guardián — solo transiciona
    el status, no envía mensaje.
    """
    lead = get_lead(lead_id)
    if not lead:
        return
    update_status(lead_id, "trial_absent", author="gelfis")
    log_timeline(
        lead_id, type="status_change", author="gelfis",
        content="Lead did not attend trial (Python mark_absent — no message sent, TS flow handles absent-interest).",
    )
