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
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from agents.agent_0_watcher import tick as agent_0_tick
# tick_absent_followups eliminada (Gelfis 2026-08-01) — flow absent-interest
# TS la reemplaza con 1 solo mensaje SÍ/NO, sin cadena legacy.
from agents.shared.outbound_queue import drain as drain_outbound_queue
from agents.whatsapp_health import tick_webhook_self_heal, tick_inbound_replay
from agents.shared.db import get_conn as _dedup_get_conn


def _cleanup_inbound_dedup() -> None:
    """Borrar entries de inbound_dedup más viejas de 7 días. La tabla solo
    sirve como protección anti-retry; un mensaje >7 días ya no va a
    re-entrar por los retries de Evolution (su buffer es mucho más corto)."""
    try:
        with _dedup_get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM inbound_dedup WHERE received_at < NOW() - INTERVAL '7 days'"
            )
            log.info("[dedup_cleanup] purged rows older than 7 days (rowcount=%s)",
                     cur.rowcount)
    except Exception as e:                              # noqa: BLE001
        log.warning("[dedup_cleanup] failed: %s", e)


def _drain_inbound_queue() -> int:
    """Cada 1 min: procesa filas 'pending' en inbound_processing_queue cuyo
    next_attempt_at <= NOW. Si Agent 4 falla, incrementa retry_count y
    aplaza con backoff exponencial. Tras 3 fallos, marca 'failed_permanent'
    y registra una escalación a Gelfis vía notifications."""
    try:
        with _dedup_get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, lead_id, text, wa_message_id, retry_count
                  FROM inbound_processing_queue
                 WHERE status = 'pending' AND next_attempt_at <= NOW()
                 ORDER BY queued_at
                 LIMIT 10
                """
            )
            jobs = list(cur.fetchall())
    except Exception as e:                              # noqa: BLE001
        log.warning("[drain_inbound] read failed: %s", e)
        return 0

    if not jobs:
        return 0

    from agents.agent_4_conversation import handle_incoming_message
    from agents.shared.leads import get_lead

    processed = 0
    for j in jobs:
        with _dedup_get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE inbound_processing_queue SET status='processing', last_attempt_at=NOW() WHERE id=%s",
                (j["id"],),
            )
        try:
            lead = get_lead(j["lead_id"])
            if not lead:
                raise RuntimeError("lead not found")
            handle_incoming_message(lead, j["text"])
            with _dedup_get_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    "UPDATE inbound_processing_queue SET status='done' WHERE id=%s",
                    (j["id"],),
                )
            processed += 1
        except Exception as e:                          # noqa: BLE001
            err = str(e)[:500]
            log.warning("[drain_inbound] retry on lead=%s err=%s",
                        str(j["lead_id"])[:8], err)
            new_retry = j["retry_count"] + 1
            if new_retry >= 3:
                with _dedup_get_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """UPDATE inbound_processing_queue
                              SET status='failed_permanent', retry_count=%s,
                                  last_error=%s
                            WHERE id=%s""",
                        (new_retry, err, j["id"]),
                    )
                # Escalar a Gelfis
                try:
                    from agents.notifications import notify_send_failed
                    notify_send_failed(
                        {"id": j["lead_id"], "name": "?",
                         "whatsapp_normalized": "?", "goal": "?", "urgency": "?"},
                        f"Inbound queue: 3 retries failed. Last error: {err}",
                    )
                except Exception:                       # noqa: BLE001
                    pass
            else:
                # Backoff: 1m, 5m
                delay_min = [1, 5][new_retry - 1] if new_retry < 3 else 5
                with _dedup_get_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """UPDATE inbound_processing_queue
                              SET status='pending', retry_count=%s, last_error=%s,
                                  next_attempt_at = NOW() + (%s || ' minutes')::interval
                            WHERE id=%s""",
                        (new_retry, err, str(delay_min), j["id"]),
                    )
    if processed:
        log.info("[drain_inbound] processed=%d", processed)
    return processed


def _reactivate_orphaned_leads() -> int:
    """Cron diario 09:00 Berlin: rescata leads en post-engagement
    (link_sent / in_conversation) que se quedaron sin next_contact_date.

    Esto cubre dos casos:
      1. Leads pre-migración 041 que nunca tuvieron next_contact_date setteado.
      2. Cualquier bug futuro donde el flow no calce next_contact_date al
         transicionar a estos estados.

    Setea next_contact_date a NOW()+30min de forma que el siguiente
    Agent 0 tick los recoja. La política de límites (rc<2 link_sent,
    rc<1 in_conversation) la aplica compose_message naturalmente.
    """
    try:
        with _dedup_get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE leads
                   SET next_contact_date = NOW() + INTERVAL '30 minutes'
                 WHERE status IN ('link_sent', 'in_conversation')
                   AND next_contact_date IS NULL
                   AND (ai_paused_until IS NULL OR ai_paused_until <= NOW())
                """
            )
            n = cur.rowcount
        if n > 0:
            log.info("[reactivate_orphans] %d leads rescued for next Agent-0 tick", n)
        return n
    except Exception as e:                              # noqa: BLE001
        log.warning("[reactivate_orphans] failed: %s", e)
        return 0
from agents.janitor import run as janitor_run
from agents.notifications import (
    notify_daily_summary,
    scan_escalations_and_notify,
    scan_silent_inbounds_and_alert,
    scan_unmatched_lids_and_alert,
    scan_evolution_health_and_alert,
)
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
                c.short_code      AS class_short_code,
                l.id              AS lead_id,
                l.name            AS lead_name,
                l.language        AS lead_language,
                l.whatsapp_normalized AS lead_whatsapp,
                l.ai_paused_until AS lead_ai_paused_until,
                tu.full_name      AS teacher_name,
                tu.email          AS teacher_email,
                tu.phone          AS teacher_whatsapp
              FROM classes c
              JOIN leads     l  ON l.id  = c.lead_id
              JOIN teachers  t  ON t.id  = c.teacher_id
              JOIN users     tu ON tu.id = t.user_id
             WHERE c.is_trial = TRUE
               AND c.status   = 'scheduled'
               AND c.scheduled_at BETWEEN %s AND %s
               -- Fix Gelfis 2026-07-24: zombies. Lead converted (no cancelamos
               -- la trial al convertir) o con reagendamiento pendiente (bot
               -- CAMBIAR/CANCELAR o profe Reagendar → clase sigue scheduled).
               AND l.status <> 'converted'
               AND (l.reschedule_state IS NULL
                    OR NOT (l.reschedule_state->>'phase' LIKE 'AWAITING_%%'))
            """,
            (lo, hi),
        )
        rows = list(cur.fetchall())

    wa: WhatsAppService | None = None
    for r in rows:
        if (r.get("notes_admin") or "").find(_PRE_CLASS_30M_TAG) >= 0:
            continue
        # Respeta ai_paused_until ("Tomo yo desde aquí" del admin) —
        # los crons TS ya lo hacen, este no lo hacía (bug audit 2026-07-24).
        paused_until = r.get("lead_ai_paused_until")
        if paused_until and paused_until > datetime.now(timezone.utc):
            continue

        scheduled_at = r["scheduled_at"]
        time_label = _format_class_time_30m(scheduled_at, r["lead_language"])
        # CRITICAL: el lead NO tiene NextAuth session. El bare URL
        # `/aula/{id}` lo rebotaria a /login. Usar shortcode si hay,
        # o el fallback /trial/{id}?t=... (todas las trials desde
        # migration 036 tienen short_code, asi que el else es defense
        # in depth). El teacher SI tiene session — bare URL OK.
        short_code = r.get("class_short_code")
        if short_code:
            join_url_lead = f"https://b2c.aprender-aleman.de/c/{short_code}"
        else:
            join_url_lead = f"https://b2c.aprender-aleman.de/trial/{r['class_id']}"
        join_url_teacher = f"https://b2c.aprender-aleman.de/aula/{r['class_id']}"

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
                wa.send_text(
                    lead_first or "lead",
                    r["lead_whatsapp"],
                    lead_text,
                    kind="trial_reminder_30m",
                    lead_id=r["lead_id"],
                )
                log_timeline(
                    r["lead_id"], type="trial_reminder", author="agent_5",
                    content="30-min pre-class WhatsApp sent to lead.",
                )
            except WhatsAppError as e:
                log.warning("30-min lead reminder failed for %s: %s", r["lead_id"], e)

        # Send to teacher
        if r.get("teacher_whatsapp"):
            try:
                wa.send_text(
                    teacher_first or "teacher",
                    r["teacher_whatsapp"],
                    teacher_text,
                    kind="trial_reminder_30m",
                )
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
    from agents.shared.db import get_config
    instance = (
        get_config("active_whatsapp_instance")
        or os.environ.get("EVOLUTION_INSTANCE_MAIN")
        or "aprender-aleman-main"
    )
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

    # (Absent follow-up sequence removed 2026-08-01 — reemplazado por el
    # flow absent-interest TS que manda 1 solo mensaje SÍ/NO.)

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

    # Cleanup de inbound_dedup cada 6h.
    sched.add_job(
        _cleanup_inbound_dedup,
        IntervalTrigger(hours=6, timezone=BERLIN),
        id="inbound_dedup_cleanup",
        max_instances=1, coalesce=True,
    )

    # Rescate diario de leads en link_sent / in_conversation sin
    # next_contact_date (cubre pre-migración 041 + cualquier futuro hueco).
    sched.add_job(
        _reactivate_orphaned_leads,
        CronTrigger(hour=9, minute=0, timezone=BERLIN),
        id="reactivate_orphaned_leads",
        max_instances=1, coalesce=True,
    )

    # Drainer de la cola persistente de inbounds (retry-safe).
    sched.add_job(
        _drain_inbound_queue,
        IntervalTrigger(minutes=1, timezone=BERLIN),
        id="drain_inbound_queue",
        max_instances=1, coalesce=True,
    )

    # ─── RELIABILITY WATCHDOGS (Phase 1 plan, 2026-04-30) ──────────────
    # Inbound silencioso (lead escribió, bot no respondió >15min).
    sched.add_job(
        scan_silent_inbounds_and_alert,
        IntervalTrigger(minutes=5, timezone=BERLIN),
        id="watchdog_silent_inbound",
        max_instances=1, coalesce=True,
    )
    # LIDs no asociados a lead — escalar a Gelfis con candidatos.
    sched.add_job(
        scan_unmatched_lids_and_alert,
        IntervalTrigger(minutes=10, timezone=BERLIN),
        id="watchdog_unmatched_lids",
        max_instances=1, coalesce=True,
    )
    # Sesión de WhatsApp en Evolution caída.
    sched.add_job(
        scan_evolution_health_and_alert,
        IntervalTrigger(minutes=10, timezone=BERLIN),
        id="watchdog_evolution_health",
        max_instances=1, coalesce=True,
    )

    # Test sintético end-to-end diario a las 09:30 Berlin (después del
    # rescate de huérfanos de 09:00 para que no compita).
    from agents.synthetic_monitor import run_synthetic_check
    sched.add_job(
        run_synthetic_check,
        CronTrigger(hour=9, minute=30, timezone=BERLIN),
        id="synthetic_monitor_daily",
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
