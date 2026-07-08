"""
Agent 0 — LEAD WATCHER (El Vigilante).

Pure code, no AI. Runs every 15 minutes during the send window
(08:00–19:00 Europe/Berlin).

For each run:
  1. Skip entirely if outside the send window.
  2. Query leads that need a follow-up:
       status = 'new', OR
       next_contact_date <= now() AND status NOT IN (paused statuses).
  3. For each lead, call Agent 1 to compose → Agent 2 to review → Agent 3 to send.
  4. Log the run to agent_run_log.

The 'paused' statuses (never contacted automatically):
    needs_human, converted, cold, lost,
    trial_scheduled, trial_reminded  (handled by Agent 5 schedule instead)

Run modes:
    python -m agents.agent_0_watcher            # start scheduler (foreground)
    python -m agents.agent_0_watcher --once     # run a single pass and exit
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime
from uuid import UUID

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from agents.shared.db import get_conn
from agents.shared.leads import handle_reactivation_sent, log_timeline
from agents.shared.rate_limits import BERLIN, in_send_window
from agents.whatsapp_service import WhatsAppError, WhatsAppService

log = logging.getLogger("agent_0")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

# Circuit breaker: if N consecutive leads error out, stop the tick early
# to avoid hammering a broken dependency (Supabase, Evolution, etc).
CIRCUIT_BREAKER_THRESHOLD = 5


PAUSED_STATUSES = (
    "needs_human",
    "converted",
    "cold",
    "lost",
    "trial_scheduled",
    "trial_reminded",
    "trial_attended",
    # Estos los maneja tick_absent_followups (agent_5_guardian) en su propio
    # cron; Agent 0 no debe tocarlos para no duplicar mensajes.
    "trial_absent",
    "absent_followup_1",
    "absent_followup_2",
    "absent_followup_3",
)

# Estados post-engagement: Agent 1 sí compone reactivaciones, pero Agent 0
# debe tratarlos diferente (no avanzar current_followup_number; en su lugar,
# llamar handle_reactivation_sent para incrementar reactivation_count y
# decidir si seguir o marcar cold).
POST_ENGAGEMENT_STATUSES = ("link_sent", "in_conversation")


def _leads_due() -> list[dict]:
    """
    Return leads Agent 0 should process this tick.

    A lead is due if EITHER:
      - status='new' AND next_contact_date IS NULL  (truly untouched, pick up ASAP)
      - next_contact_date IS NOT NULL AND <= NOW() AND status not paused
        (any lead whose scheduled next-contact time has arrived)

    We require next_contact_date IS NULL for 'new' so that when Agent 3
    postpones a failed first-contact attempt, the lead isn't immediately
    re-picked on the next tick.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, name, whatsapp_normalized, language, german_level,
                   goal, urgency, status, current_followup_number,
                   next_contact_date, messages_seen_count,
                   reactivation_count, ai_paused_until
              FROM leads
             WHERE (status = 'new' AND next_contact_date IS NULL)
                OR (
                       next_contact_date IS NOT NULL
                   AND next_contact_date <= NOW()
                   AND status NOT IN ({",".join(["%s"] * len(PAUSED_STATUSES))})
                   -- Respetar pausa manual de admin
                   AND (ai_paused_until IS NULL OR ai_paused_until <= NOW())
                   -- Excluir leads de la cadena post-clase de prueba
                   -- (los maneja /api/cron/post-trial-followups en Vercel
                   --  con su propio copy + email espejo).
                   AND NOT (
                         status = 'in_conversation'
                     AND meta IS NOT NULL
                     AND meta->>'awaiting_payment_confirmation_since' IS NOT NULL
                   )
                )
             ORDER BY
                 CASE WHEN status = 'new' THEN 0 ELSE 1 END,
                 COALESCE(next_contact_date, created_at) ASC
             LIMIT 100
            """,
            PAUSED_STATUSES,
        )
        return list(cur.fetchall())


def _start_run() -> UUID:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO agent_run_log (agent_name, started_at)
            VALUES ('agent_0', NOW())
            RETURNING id
            """
        )
        return cur.fetchone()["id"]


def _finish_run(run_id: UUID, leads_processed: int, errors: int, note: str = "") -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE agent_run_log
               SET finished_at = NOW(),
                   leads_processed = %s,
                   errors_count = %s,
                   notes = %s
             WHERE id = %s
            """,
            (leads_processed, errors, note[:2000] or None, run_id),
        )


def tick() -> None:
    """One pass. Safe to call any number of times."""
    if not in_send_window():
        log.info("Outside send window — skipping tick.")
        return

    run_id = _start_run()
    leads = _leads_due()
    log.info("Tick: %d lead(s) due.", len(leads))

    errors = 0
    consecutive_errors = 0
    processed = 0
    wa: WhatsAppService | None = None
    circuit_broken = False

    # Lazy imports — Agents 1/2 land in the next build steps.
    from agents.agent_1_writer import compose_message
    from agents.agent_2_reviewer import review_single
    from agents.agent_3_sender import send_approved

    for lead in leads:
        if consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD:
            circuit_broken = True
            log.error(
                "Circuit breaker tripped after %d consecutive errors — "
                "aborting tick with %d leads remaining.",
                consecutive_errors, len(leads) - processed - errors,
            )
            break

        try:
            # 1. Compose via Agent 1.
            draft = compose_message(lead)
            if draft is None:
                log.info("Lead %s: Agent 1 had nothing to send.", lead["id"])
                consecutive_errors = 0
                continue

            # 2. Review via Agent 2.
            review = review_single(lead, draft)
            if not review.approved:
                log.warning("Lead %s: Agent 2 rejected — %s", lead["id"], review.reason)
                log_timeline(
                    lead["id"],
                    type="agent_note",
                    author="agent_2",
                    content=f"Rejected draft: {review.reason}",
                    metadata={"draft": draft.text[:500]},
                )
                consecutive_errors = 0
                continue

            # 3. Send via Agent 3.
            if wa is None:
                wa = WhatsAppService()
            is_new = lead["status"] == "new"
            is_reactivation = lead["status"] in POST_ENGAGEMENT_STATUSES
            result = send_approved(
                lead, draft.text,
                is_new_conversation=is_new,
                advance_followup=not is_reactivation,
                wa=wa,
            )
            if not result.success:
                errors += 1
                consecutive_errors += 1
                continue
            processed += 1
            consecutive_errors = 0
            if is_reactivation:
                handle_reactivation_sent(
                    lead["id"],
                    status=lead["status"],
                    current_count=int(lead.get("reactivation_count") or 0),
                )
        except WhatsAppError as e:
            errors += 1
            consecutive_errors += 1
            log.error("Lead %s: WhatsApp error — %s", lead["id"], e)
            log_timeline(
                lead["id"], type="send_failed", author="agent_0",
                content=f"WhatsApp error during tick: {e}",
            )
        except Exception as e:  # noqa: BLE001
            errors += 1
            consecutive_errors += 1
            log.exception("Lead %s: unexpected error", lead["id"])
            log_timeline(
                lead["id"], type="agent_note", author="agent_0",
                content=f"Unexpected error during tick: {type(e).__name__}: {e}",
            )

    note = f"due={len(leads)} processed={processed} errors={errors}"
    if circuit_broken:
        note += " CIRCUIT_BREAKER_TRIPPED"
    _finish_run(run_id, leads_processed=processed, errors=errors, note=note)


def main() -> int:
    parser = argparse.ArgumentParser(description="Agent 0 — Lead Watcher")
    parser.add_argument("--once", action="store_true", help="Run a single tick and exit.")
    args = parser.parse_args()

    if args.once:
        tick()
        return 0

    sched = BlockingScheduler(timezone=BERLIN)
    # Every 15 min between minute 0 and minute 59, but CronTrigger with
    # `minute="*/15"` gives us :00 :15 :30 :45 which is cleaner for ops.
    sched.add_job(
        tick,
        CronTrigger(minute="*/15", hour="8-18", timezone=BERLIN),
        id="agent_0_tick",
        max_instances=1,
        coalesce=True,
    )
    log.info("Agent 0 scheduler started. Ctrl+C to stop.")
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Shutting down.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
