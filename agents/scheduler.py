"""
Scheduler — the one process that drives every periodic job.

Jobs registered:

  * Agent 0 tick                         — every 15 min, 08:00–18:45 Berlin
  * Trial reminders for today            — 08:00 Berlin
  * T-30min pings to Gelfis              — every 5 min
  * Escalation scan → notify Gelfis      — every 5 min
  * Absent-follow-up tick                — hourly, within send window
  * Daily summary → Gelfis               — 19:00 Berlin

Run:  python -m agents.scheduler

In production this is the `aa-scheduler` systemd unit.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from agents.agent_0_watcher import tick as agent_0_tick
from agents.agent_5_guardian import send_trial_reminders_for_today, tick_absent_followups
from agents.janitor import run as janitor_run
from agents.notifications import notify_daily_summary, notify_trial_30min, scan_escalations_and_notify
from agents.shared.db import get_conn
from agents.shared.heartbeat import beat
from agents.shared.rate_limits import BERLIN

log = logging.getLogger("scheduler")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


def _notify_trials_30min() -> None:
    """Ping Gelfis when a trial is ~30 minutes away."""
    now_utc = datetime.utcnow()
    lo = now_utc + timedelta(minutes=25)
    hi = now_utc + timedelta(minutes=35)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, whatsapp_normalized, trial_scheduled_at, trial_zoom_link
              FROM leads
             WHERE status IN ('trial_scheduled','trial_reminded')
               AND trial_scheduled_at BETWEEN %s AND %s
            """,
            (lo, hi),
        )
        leads = list(cur.fetchall())
    for lead in leads:
        notify_trial_30min(lead)


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

    # Trial reminders for the day (08:00 Berlin)
    sched.add_job(
        send_trial_reminders_for_today,
        CronTrigger(hour=8, minute=0, timezone=BERLIN),
        id="trial_reminders_morning",
        max_instances=1, coalesce=True,
    )

    # T-30min pings to Gelfis
    sched.add_job(
        _notify_trials_30min,
        IntervalTrigger(minutes=5, timezone=BERLIN),
        id="notify_trials_30min",
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

    log.info("Scheduler started with %d jobs.", len(sched.get_jobs()))
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Shutting down.")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
