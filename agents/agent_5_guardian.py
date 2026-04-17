"""
Agent 5 — GUARDIAN AGENT (Calendly & Conversion Monitor).

Event-driven, mostly pure code with one small AI call for trial reminders.

Triggers:
  * Calendly webhook: invitee.created / invitee.canceled
  * Dashboard actions: mark_attended_converted / mark_attended_lost / mark_absent
  * Scheduler tick (8:00 Europe/Berlin): send same-day trial reminders
  * Scheduler tick (hourly): absent follow-up sequence

Public surface:

    on_calendly_invitee_created(payload)
    on_calendly_invitee_canceled(payload)
    mark_attended_converted(lead_id)
    mark_attended_lost(lead_id, reason)
    mark_absent(lead_id)
    send_trial_reminders_for_today()
    tick_absent_followups()
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import pytz

from agents.agent_3_sender import send_approved
from agents.shared.db import get_conn
from agents.shared.leads import get_lead, get_lead_by_phone, log_timeline, update_status
from agents.shared.phone import normalize_phone
from agents.shared.rate_limits import BERLIN

log = logging.getLogger("agent_5")


# ──────────────────────────────────────────────────────────
# Calendly inbound
# ──────────────────────────────────────────────────────────

def _extract_phone(calendly_invitee: dict) -> str | None:
    """Calendly puts the phone in questions_and_answers OR payload.questions."""
    # First try the standard 'text_reminder_number' on the invitee
    phone = calendly_invitee.get("text_reminder_number")
    if phone:
        return phone

    # Then scan questions & answers (form fields)
    qa = calendly_invitee.get("questions_and_answers") or calendly_invitee.get("questions") or []
    for entry in qa:
        q = (entry.get("question") or "").lower()
        if any(k in q for k in ("whatsapp", "phone", "telefon", "teléfono", "telefono")):
            ans = entry.get("answer") or entry.get("response")
            if ans:
                return ans
    return None


def _extract_email(calendly_invitee: dict) -> str | None:
    return calendly_invitee.get("email")


def _extract_name(calendly_invitee: dict) -> str | None:
    return calendly_invitee.get("name") or calendly_invitee.get("first_name")


def _extract_event_time(calendly_event: dict) -> datetime | None:
    raw = calendly_event.get("start_time") or calendly_event.get("start")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _extract_join_url(calendly_event: dict) -> str | None:
    loc = calendly_event.get("location")
    if isinstance(loc, dict):
        return loc.get("join_url") or loc.get("location")
    return calendly_event.get("join_url")


def on_calendly_invitee_created(payload: dict) -> str | None:
    """
    Handle Calendly webhook for a new trial booking. Returns the lead_id
    handled (new or updated), or None on failure.
    """
    data = payload.get("payload", {})
    event = data.get("event", {}) or data.get("scheduled_event", {})
    invitee = data

    raw_phone = _extract_phone(invitee)
    if not raw_phone:
        log.warning("Calendly webhook without phone number — cannot link.")
        return None

    try:
        normalized = normalize_phone(raw_phone)
    except ValueError as e:
        log.warning("Calendly phone normalization failed: %s", e)
        return None

    email = _extract_email(invitee)
    name = _extract_name(invitee) or "Invitado"
    trial_at = _extract_event_time(event)
    join_url = _extract_join_url(event)

    existing = get_lead_by_phone(normalized)
    if existing:
        lead_id = existing["id"]
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE leads
                   SET status = 'trial_scheduled',
                       trial_scheduled_at = %s,
                       trial_zoom_link    = %s,
                       email              = COALESCE(email, %s)
                 WHERE id = %s
                """,
                (trial_at, join_url, email, lead_id),
            )
        log_timeline(
            lead_id, type="calendly_event", author="agent_5",
            content=f"Trial booked for {trial_at.isoformat() if trial_at else '?'}",
            metadata={"join_url": join_url, "source": "webhook"},
        )
    else:
        # Lead came straight from Calendly without going through the funnel.
        # Create a minimal lead record with source='calendly_direct'.
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO leads
                    (name, whatsapp_normalized, whatsapp_raw, email, language,
                     german_level, goal, urgency, status,
                     trial_scheduled_at, trial_zoom_link, gdpr_accepted,
                     gdpr_accepted_at, source)
                VALUES (%s, %s, %s, %s, 'es',
                        'A0', 'work', 'asap', 'trial_scheduled',
                        %s, %s, TRUE, NOW(), 'calendly_direct')
                RETURNING id
                """,
                (name, normalized, raw_phone, email, trial_at, join_url),
            )
            lead_id = cur.fetchone()["id"]
        log_timeline(
            lead_id, type="calendly_event", author="agent_5",
            content="Lead created directly from Calendly booking.",
            metadata={"join_url": join_url, "source": "calendly_direct"},
        )

    # Send a confirmation WhatsApp.
    lead = get_lead(lead_id)
    if lead:
        _send_trial_confirmation(lead)
    return lead_id


def on_calendly_invitee_canceled(payload: dict) -> str | None:
    data = payload.get("payload", {})
    invitee = data
    raw_phone = _extract_phone(invitee)
    if not raw_phone:
        return None
    try:
        normalized = normalize_phone(raw_phone)
    except ValueError:
        return None

    lead = get_lead_by_phone(normalized)
    if not lead:
        return None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE leads
               SET status = 'in_conversation',
                   trial_scheduled_at = NULL,
                   trial_zoom_link = NULL
             WHERE id = %s
            """,
            (lead["id"],),
        )
    log_timeline(
        lead["id"], type="calendly_event", author="agent_5",
        content="Lead canceled their trial booking via Calendly.",
    )
    return lead["id"]


# ──────────────────────────────────────────────────────────
# Outbound messages (trial confirmation / reminder / welcome / goodbye)
# ──────────────────────────────────────────────────────────


def _first_name(lead: dict) -> str:
    return (lead.get("name") or "").strip().split()[0] if lead.get("name") else ""


def _format_when(dt: datetime | None, lang: str) -> tuple[str, str]:
    """Return (human date, human time) in the lead's language, in Berlin tz."""
    if not dt:
        return "pronto", "—"
    local = dt.astimezone(BERLIN) if dt.tzinfo else BERLIN.localize(dt)
    if lang == "de":
        date = local.strftime("%d.%m.%Y")
        time = local.strftime("%H:%M")
    else:
        date = local.strftime("%d/%m/%Y")
        time = local.strftime("%H:%M")
    return date, time


def _send_trial_confirmation(lead: dict) -> None:
    name = _first_name(lead)
    date, time = _format_when(lead.get("trial_scheduled_at"), lead["language"])
    link = lead.get("trial_zoom_link") or "(te lo enviaré en el recordatorio)"
    if lead["language"] == "de":
        body = (
            f"Super, {name}! 🎉\n"
            f"Deine Probestunde ist am {date} um {time} Uhr.\n"
            f"Hier ist der Link: {link}\n"
            f"Kannst du mir kurz bestätigen, dass du dabei bist?\n"
            f"— Stiv"
        )
    else:
        body = (
            f"¡Perfecto, {name}! 🎉\n"
            f"Tu clase de prueba está agendada para el {date} a las {time}.\n"
            f"Aquí tienes el enlace: {link}\n"
            f"¿Me confirmas que asistirás?\n"
            f"— Stiv"
        )
    send_approved(lead, body, is_new_conversation=False)


def _send_trial_reminder(lead: dict) -> None:
    name = _first_name(lead)
    _, time = _format_when(lead.get("trial_scheduled_at"), lead["language"])
    link = lead.get("trial_zoom_link") or ""
    if lead["language"] == "de":
        body = (
            f"Hallo {name}! \n"
            f"Erinnerung: Deine Probestunde ist heute um {time} Uhr.\n"
            f"Link: {link}\n"
            f"Bis gleich! 😊\n"
            f"— Stiv"
        )
    else:
        body = (
            f"¡Hola {name}!\n"
            f"Recordatorio de tu clase de prueba hoy a las {time}.\n"
            f"Enlace: {link}\n"
            f"¡Nos vemos! 😊\n"
            f"— Stiv"
        )
    send_approved(lead, body, is_new_conversation=False)


def _send_welcome_message(lead: dict) -> None:
    name = _first_name(lead)
    if lead["language"] == "de":
        body = (
            f"Willkommen bei Aprender-Aleman.de, {name}! 🎉\n"
            f"Wir freuen uns sehr, dass du dabei bist.\n"
            f"Während du auf deine Stunden wartest, kannst du schon auf "
            f"SCHULE zugreifen — unserem virtuellen Klassenzimmer. "
            f"Kostenlos für alle unsere Schüler:\n"
            f"https://schule.aprender-aleman.de\n"
            f"Offiziell willkommen in der Akademie. 🇩🇪\n"
            f"— Stiv"
        )
    else:
        body = (
            f"¡Bienvenido a Aprender-Aleman.de, {name}! 🎉\n"
            f"Estamos felices de tenerte con nosotros.\n"
            f"Mientras esperas tus clases, ya puedes acceder a SCHULE, "
            f"nuestra aula virtual — es gratis para todos nuestros alumnos:\n"
            f"https://schule.aprender-aleman.de\n"
            f"Bienvenido oficialmente a la Academia. 🇩🇪\n"
            f"— Stiv"
        )
    send_approved(lead, body, is_new_conversation=False)


def _send_goodbye(lead: dict) -> None:
    name = _first_name(lead)
    if lead["language"] == "de":
        body = f"Alles Gute, {name}. 🧡\n— Stiv"
    else:
        body = f"Te deseamos lo mejor, {name}. 🧡\n— Stiv"
    send_approved(lead, body, is_new_conversation=False)


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


def send_trial_reminders_for_today() -> int:
    """Run once per morning (08:00 Europe/Berlin). Sends same-day reminders."""
    now = datetime.now(BERLIN)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, whatsapp_normalized, language,
                   german_level, goal, urgency, status,
                   trial_scheduled_at, trial_zoom_link
              FROM leads
             WHERE status IN ('trial_scheduled')
               AND trial_scheduled_at >= %s
               AND trial_scheduled_at <  %s
            """,
            (start, end),
        )
        leads = list(cur.fetchall())

    for lead in leads:
        try:
            _send_trial_reminder(lead)
            update_status(lead["id"], "trial_reminded", author="agent_5")
        except Exception:  # noqa: BLE001
            log.exception("Failed to send trial reminder to lead %s", lead["id"])
    return len(leads)


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
            f"Hallo {name}, alles gut bei dir? 😊\n"
            f"Ich habe gesehen, dass du gestern nicht in der Probestunde warst. "
            f"Möchtest du einen neuen Termin vereinbaren?\n"
            f"— Stiv"
        ) if lang == "de" else (
            f"Hola {name}, ¿todo bien? 😊\n"
            f"Vi que ayer no pudiste conectarte a la clase de prueba. "
            f"¿Quieres que reagendemos?\n"
            f"— Stiv"
        )
        next_status = "absent_followup_1"
        next_delta = timedelta(days=3)  # +4d after absent total
    elif status == "absent_followup_1":
        body = (
            f"Hallo {name}, ich versuche es noch einmal. 🧡\n"
            f"Wenn du Deutsch immer noch lernen möchtest, sag mir Bescheid "
            f"und wir suchen einen neuen Termin.\n"
            f"— Stiv"
        ) if lang == "de" else (
            f"Hola {name}, vuelvo a escribirte. 🧡\n"
            f"Si aún te interesa aprender alemán, dímelo y coordinamos un "
            f"nuevo horario.\n"
            f"— Stiv"
        )
        next_status = "absent_followup_2"
        next_delta = timedelta(days=6)
    else:  # absent_followup_2
        body = (
            f"Hallo {name}, letztes Mal von meiner Seite. \n"
            f"Falls du Deutsch lernen möchtest, schreib mir einfach — ansonsten "
            f"alles Gute für dich! 🧡\n"
            f"— Stiv"
        ) if lang == "de" else (
            f"Hola {name}, último mensaje por mi parte.\n"
            f"Si quieres aprender alemán, escríbeme — si no, te deseamos lo "
            f"mejor. 🧡\n"
            f"— Stiv"
        )
        next_status = "lost"
        next_delta = None

    result = send_approved(lead, body, is_new_conversation=False)
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
