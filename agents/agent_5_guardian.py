"""
Agent 5 — GUARDIAN AGENT (post-trial conversion monitor).

Event-driven, mostly pure code. Calendly used to live here too but the
self-book funnel replaced it; the only relevant trigger now is the
dashboard / absent-followup state machine.

Triggers:
  * Dashboard actions: mark_attended_converted / mark_attended_lost / mark_absent
  * Scheduler tick (hourly): absent follow-up sequence

Pre-class reminders are owned by the web side now:
  * /api/cron/trial-reminders-24h    — 24h-before email (lead + teacher)
  * /api/cron/trial-reminders-morning — 8 AM same-day email (lead + teacher)
  * scheduler._notify_trials_30min   — 30-min-before WhatsApp (lead + teacher)

Public surface:

    mark_attended_converted(lead_id)
    mark_attended_lost(lead_id, reason)
    mark_absent(lead_id)
    tick_absent_followups()
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from agents.agent_3_sender import send_approved
from agents.shared.db import get_conn
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
            f"Stiv, Aprender-Aleman.de"
        )
    else:
        body = (
            f"¡Bienvenido a Aprender-Aleman.de, {name}! 🎉\n\n"
            f"Estamos felices de tenerte con nosotros.\n\n"
            f"Mientras esperas tus clases, ya puedes acceder a SCHULE, nuestra "
            f"aula virtual gratuita:\n"
            f"https://schule.aprender-aleman.de\n\n"
            f"Bienvenido oficialmente a la Academia. 🇩🇪\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
    send_approved(lead, body, is_new_conversation=False, advance_followup=False)


def _send_goodbye(lead: dict) -> None:
    name = _first_name(lead)
    if lead["language"] == "de":
        body = f"Alles Gute, {name}. 🧡\n\nStiv, Aprender-Aleman.de"
    else:
        body = f"Te deseamos lo mejor, {name}. 🧡\n\nStiv, Aprender-Aleman.de"
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
    lead = get_lead(lead_id)
    if not lead:
        return
    update_status(lead_id, "trial_absent", author="gelfis")
    # Schedule the first absent follow-up for +1 day.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE leads
               SET next_contact_date = NOW() + INTERVAL '1 day'
             WHERE id = %s
            """,
            (lead_id,),
        )
    log_timeline(
        lead_id, type="status_change", author="gelfis",
        content="Lead did not attend trial — absent follow-up scheduled.",
    )


# ──────────────────────────────────────────────────────────
# Scheduled ticks
# ──────────────────────────────────────────────────────────


def tick_absent_followups() -> int:
    """Hourly tick to advance the absent-followup sequence."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, whatsapp_normalized, language,
                   german_level, goal, urgency, status,
                   current_followup_number
              FROM leads
             WHERE status IN ('trial_absent', 'absent_followup_1', 'absent_followup_2')
               AND next_contact_date IS NOT NULL
               AND next_contact_date <= NOW()
            """
        )
        leads = list(cur.fetchall())

    count = 0
    for lead in leads:
        _process_absent_followup(lead)
        count += 1
    return count


def _process_absent_followup(lead: dict) -> None:
    status = lead["status"]
    name = _first_name(lead)
    lang = lead["language"]

    if status == "trial_absent":
        body = (
            f"Hallo {name}, alles gut bei dir? 😊\n\n"
            f"Ich habe gesehen, dass du gestern nicht in der Probestunde warst.\n\n"
            f"Möchtest du einen neuen Termin vereinbaren?\n\n"
            f"Stiv, Aprender-Aleman.de"
        ) if lang == "de" else (
            f"Hola {name}, ¿todo bien? 😊\n\n"
            f"Vi que ayer no pudiste conectarte a la clase de prueba.\n\n"
            f"¿Quieres que reagendemos?\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
        next_status = "absent_followup_1"
        next_delta = timedelta(days=3)  # +4d after absent total
    elif status == "absent_followup_1":
        body = (
            f"Hallo {name}, ich versuche es noch einmal. 🧡\n\n"
            f"Wenn du Deutsch immer noch lernen möchtest, sag mir Bescheid "
            f"und wir suchen einen neuen Termin.\n\n"
            f"Stiv, Aprender-Aleman.de"
        ) if lang == "de" else (
            f"Hola {name}, vuelvo a escribirte. 🧡\n\n"
            f"Si aún te interesa aprender alemán, dímelo y coordinamos "
            f"un nuevo horario.\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
        next_status = "absent_followup_2"
        next_delta = timedelta(days=6)
    else:  # absent_followup_2
        body = (
            f"Hallo {name}, letztes Mal von meiner Seite.\n\n"
            f"Falls du Deutsch lernen möchtest, schreib mir einfach — "
            f"ansonsten alles Gute für dich! 🧡\n\n"
            f"Stiv, Aprender-Aleman.de"
        ) if lang == "de" else (
            f"Hola {name}, último mensaje por mi parte.\n\n"
            f"Si quieres aprender alemán, escríbeme — si no, te deseamos "
            f"lo mejor. 🧡\n\n"
            f"Stiv, Aprender-Aleman.de"
        )
        next_status = "lost"
        next_delta = None

    result = send_approved(lead, body, is_new_conversation=False, advance_followup=False)
    if not result.success:
        return

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE leads
               SET status = %s,
                   next_contact_date = %s
             WHERE id = %s
            """,
            (
                next_status,
                (datetime.utcnow() + next_delta) if next_delta else None,
                lead["id"],
            ),
        )
