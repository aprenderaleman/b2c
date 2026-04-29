"""
Scheduler — the one process that drives every periodic job.

Jobs registered:

  * Agent 0 tick                          — every 15 min, 08:00–18:45 Berlin
  * T-30min pre-class WhatsApp            — every 5 min (sends to lead AND teacher)
  * Escalation scan → notify Gelfis       — every 5 min
  * Absent-follow-up tick                 — hourly, within send window
  * Daily summary → Gelfis                — 19:00 Berlin

24h-before and 8 AM same-day reminders are EMAIL — owned by Vercel cron
on the web side (/api/cron/trial-reminders-24h, /api/cron/trial-reminders-morning).

Run:  python -m agents.scheduler

In production this is the `aa-scheduler` systemd unit.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from agents.agent_0_watcher import tick as agent_0_tick
from agents.agent_5_guardian import tick_absent_followups
from agents.shared.outbound_queue import drain as drain_outbound_queue
from agents.whatsapp_health import tick_webhook_self_heal, tick_inbound_replay
from agents.janitor import run as janitor_run
from agents.notifications import notify_daily_summary, scan_escalations_and_notify
from agents.shared.db import get_conn
from agents.shared.heartbeat import beat
from agents.shared.leads import log_timeline
from agents.shared.rate_limits import BERLIN
from agents.whatsapp_service import WhatsAppError, WhatsAppService

log = logging.getLogger("scheduler")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


_PRE_CLASS_30M_TAG = "[pre_class_30m_sent]"


def _format_class_time_30m(scheduled_at: datetime, lang: str) -> str:
    """E.g. '17:30' — short label used in the 30-min reminder."""
    local = scheduled_at.astimezone(BERLIN) if scheduled_at.tzinfo else BERLIN.localize(scheduled_at)
    return local.strftime("%H:%M")


def _notify_trials_30min() -> None:
    """Send a SHORT WhatsApp 30 min before each upcoming trial.

    Recipients:
      * Lead   — only if they gave us their WhatsApp number.
      * Teacher — always (their WhatsApp is required to be a teacher).

    Idempotency:
      * `classes.notes_admin` carries the `_PRE_CLASS_30M_TAG` once we've
        fired this reminder for that class. The cron runs every 5 min so
        without the tag we'd spam.
    """
    now_utc = datetime.utcnow()
    lo = now_utc + timedelta(minutes=25)
    hi = now_utc + timedelta(minutes=35)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                c.id              AS class_id,
                c.scheduled_at,
                c.duration_minutes,
                c.notes_admin,
                l.id              AS lead_id,
                l.name            AS lead_name,
                l.language        AS lead_language,
                l.whatsapp_normalized AS lead_whatsapp,
                tu.full_name      AS teacher_name,
                tu.email          AS teacher_email,
                tu.whatsapp_e164  AS teacher_whatsapp
              FROM classes c
              JOIN leads     l  ON l.id  = c.lead_id
              JOIN teachers  t  ON t.id  = c.teacher_id
              JOIN users     tu ON tu.id = t.user_id
             WHERE c.is_trial = TRUE
               AND c.status   = 'scheduled'
               AND c.scheduled_at BETWEEN %s AND %s
            """,
            (lo, hi),
        )
        rows = list(cur.fetchall())

    wa: WhatsAppService | None = None
    for r in rows:
        if (r.get("notes_admin") or "").find(_PRE_CLASS_30M_TAG) >= 0:
            continue

        scheduled_at = r["scheduled_at"]
        time_label = _format_class_time_30m(scheduled_at, r["lead_language"])
        join_url_lead    = f"https://b2c.aprender-aleman.de/aula/{r['class_id']}"
        join_url_teacher = join_url_lead

        # ── Lead message (short) ──
        lang = r["lead_language"] or "es"
        lead_first = (r["lead_name"] or "").split()[0] or ""
        if lang == "de":
            lead_text = (
                f"⏰ {lead_first}, deine Probestunde startet um {time_label} (Berlin).\n\n"
                f"Klick hier um beizutreten:\n{join_url_lead}\n\n"
                f"— Aprender-Aleman.de"
            )
        else:
            lead_text = (
                f"⏰ {lead_first}, tu clase de prueba empieza a las {time_label} (Berlín).\n\n"
                f"Únete aquí:\n{join_url_lead}\n\n"
                f"— Aprender-Aleman.de"
            )

        # ── Teacher message ──
        teacher_first = (r.get("teacher_name") or "").split()[0] or ""
        teacher_text = (
            f"⏰ {teacher_first}, clase de prueba a las {time_label} (Berlín) "
            f"con {r.get('lead_name') or 'lead'}.\n\n"
            f"Aula: {join_url_teacher}\n\n"
            f"— Aprender-Aleman.de"
        )

        if wa is None:
            try:
                wa = WhatsAppService()
            except Exception as e:  # noqa: BLE001
                log.exception("WhatsAppService init failed: %s", e)
                continue

        # Send to lead (only if they gave a number)
        if r.get("lead_whatsapp"):
            try:
                wa.send_text(r["lead_whatsapp"], lead_text)
                log_timeline(
                    r["lead_id"], type="trial_reminder", author="agent_5",
                    content="30-min pre-class WhatsApp sent to lead.",
                )
            except WhatsAppError as e:
                log.warning("30-min lead reminder failed for %s: %s", r["lead_id"], e)

        # Send to teacher
        if r.get("teacher_whatsapp"):
            try:
                wa.send_text(r["teacher_whatsapp"], teacher_text)
            except WhatsAppError as e:
                log.warning("30-min teacher reminder failed for class %s: %s", r["class_id"], e)

        # Mark fired so we don't repeat in the next 5-min cycle.
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE classes
                   SET notes_admin = COALESCE(notes_admin || E'\n', '') || %s
                 WHERE id = %s
                """,
                (_PRE_CLASS_30M_TAG, r["class_id"]),
            )


def _agent_0_tick_with_beat() -> None:
    """Wraps Agent 0's tick so every cycle leaves a heartbeat, even if the
    tick skipped (outside send window). Lets the janitor detect a truly
    frozen scheduler vs. a correctly idle one."""
    try:
        agent_0_tick()
    finally:
        try:
            beat("scheduler", note="agent_0 tick")
        except Exception as e:
            log.warning("heartbeat write failed: %s", e)


def _drain_outbound_with_beat() -> None:
    """Worker tick for outbound_queue. Imports WhatsAppService lazily to
    avoid a hard dep at scheduler boot (so a missing API key doesn't kill
    the entire scheduler — janitor still runs)."""
    from agents.whatsapp_service import WhatsAppService
    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    wa = WhatsAppService()
    def _send(phone: str, body: str) -> str:
        # Pass kind=retry so the inner enqueue (if it fails again) tags
        # the row appropriately. lead_id stays as the original.
        return wa.send_text(instance, phone, body, kind="retry")
    summary = drain_outbound_queue(_send, batch_size=20)
    if summary["sent"] or summary["requeued"] or summary["failed"]:
        log.info("outbound_queue tick: %s", summary)


def _heartbeat_keepalive() -> None:
    """Pure scheduler-liveness signal — runs every 5 min 24/7 (not tied to
    business hours), so outside the Agent 0 window the janitor doesn't
    mistake an idle evening for a frozen container."""
    try:
        beat("scheduler", note="keepalive")
    except Exception as e:
        log.warning("heartbeat keepalive failed: %s", e)


def main() -> int:
    # BOOTSTRAP BEAT — write a fresh heartbeat BEFORE starting APScheduler.
    # Without this, a just-booted container has no recent 'scheduler' beat;
    # the janitor fires 10 min later, reads an old stale value from the DB,
    # and kills the container again → restart loop.
    try:
        beat("scheduler", note="bootstrap")
        log.info("bootstrap heartbeat written")
    except Exception as e:
        log.warning("bootstrap heartbeat failed (continuing anyway): %s", e)

    sched = BlockingScheduler(timezone=BERLIN)

    # Pure liveness heartbeat — 5 min, 24/7. Decoupled from Agent 0 so the
    # container stays "alive" even outside business hours.
    sched.add_job(
        _heartbeat_keepalive,
        IntervalTrigger(minutes=5, timezone=BERLIN),
        id="heartbeat_keepalive",
        max_instances=1, coalesce=True,
    )

    # Agent 0 — lead watcher
    sched.add_job(
        _agent_0_tick_with_beat,
        CronTrigger(minute="*/15", hour="8-18", timezone=BERLIN),
        id="agent_0_tick",
        max_instances=1, coalesce=True,
    )

    # Janitor — self-healing. Runs every 10 min, 24/7 (even outside the
    # send window and on Sundays — it's the thing that catches freezes).
    sched.add_job(
        janitor_run,
        IntervalTrigger(minutes=10, timezone=BERLIN),
        id="janitor",
        max_instances=1, coalesce=True,
    )

    # 30-min pre-class WhatsApp to lead AND teacher.
    # Email reminders (24h-before, 8 AM same-day) live on the web side
    # as Vercel cron jobs.
    sched.add_job(
        _notify_trials_30min,
        IntervalTrigger(minutes=5, timezone=BERLIN),
        id="trial_30min_whatsapp",
        max_instances=1, coalesce=True,
    )

    # Escalation sweep
    sched.add_job(
        scan_escalations_and_notify,
        IntervalTrigger(minutes=5, timezone=BERLIN),
        id="escalation_sweep",
        max_instances=1, coalesce=True,
    )

    # Absent follow-up sequence
    sched.add_job(
        tick_absent_followups,
        CronTrigger(minute=10, hour="8-18", timezone=BERLIN),
        id="absent_followups",
        max_instances=1, coalesce=True,
    )

    # Daily summary
    sched.add_job(
        notify_daily_summary,
        CronTrigger(hour=19, minute=0, timezone=BERLIN),
        id="daily_summary",
        max_instances=1, coalesce=True,
    )

    # Outbound retry queue worker — drains rows whose next_attempt_at
    # is due, with exponential backoff. Runs every 30 s.
    sched.add_job(
        _drain_outbound_with_beat,
        IntervalTrigger(seconds=30, timezone=BERLIN),
        id="outbound_retry",
        max_instances=1, coalesce=True,
    )

    # WhatsApp webhook health & inbound replay — every 10 min.
    # Self-heals if Evolution dropped the webhook config, and replays
    # any inbound messages that never reached our pipeline (the case
    # that left Aisa unanswered).
    sched.add_job(
        tick_webhook_self_heal,
        IntervalTrigger(minutes=10, timezone=BERLIN),
        id="whatsapp_webhook_heal",
        max_instances=1, coalesce=True,
    )
    sched.add_job(
        tick_inbound_replay,
        IntervalTrigger(minutes=10, timezone=BERLIN),
        id="whatsapp_inbound_replay",
        max_instances=1, coalesce=True,
    )

    log.info("Scheduler started with %d jobs.", len(sched.get_jobs()))
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Shutting down.")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
