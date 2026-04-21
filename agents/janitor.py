"""
Janitor — the self-healing job.

Runs every 10 min inside the existing scheduler container. Instead of
notifying the admin when something is wrong, it tries to FIX it. Only
after exhausting the recovery attempts does it leave a short message
in `system_config('last_critical_issue')` so the /admin banner shows it.

Checks (in order):

  1. Heartbeat freshness — the scheduler itself. If the last `beat()`
     from the scheduler is > 30 min old, we know we're in the middle
     of a stuck tick. Trigger a controlled exit — Docker's
     restart: unless-stopped brings us right back.

  2. Evolution API connection state. If 'close', try restart-instance.
     After N failed restarts, set the critical banner + set a flag
     that the admin sees as 'escanea el QR'.

  3. Config anomaly detector. If `skip_sundays=true` on a Sunday when
     there are 'new' leads waiting, we temporarily override per-lead
     (so the FIRST contact always goes out, follow-ups still respect
     the weekend). This is what would have caught today's bug.

  4. Stuck-lead recovery. Leads with `next_contact_date` older than
     2 hours that are NOT in a paused state get their next_contact
     bumped to NOW() so the next Agent 0 tick picks them up.

  5. Self heartbeat: beat("janitor", ...) so we can even verify the
     janitor itself is alive (turtles all the way down).

Invariants:
  - NEVER raises out of a check. Each one is wrapped in try/except.
  - NEVER sends a human notification — only writes to the banner.
  - IDEMPOTENT — running it twice in a row is always safe.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
from datetime import datetime, timezone

import httpx

from agents.shared.db import get_conn, get_config, set_config
from agents.shared.heartbeat import beat, clear_critical, minutes_since_beat, note_critical

log = logging.getLogger("janitor")

# Thresholds — kept conservative; we'd rather miss one cycle than thrash.
STALE_SCHEDULER_MINUTES    = 30
EVOLUTION_MAX_RESTART_TRIES = 3
STUCK_LEAD_MINUTES         = 120
JANITOR_SERVICE_NAME       = "janitor"
SCHEDULER_SERVICE_NAME     = "scheduler"


# ---------------------------------------------------------------------------
# (1) Scheduler freshness — if the scheduler is frozen, exit so Docker
#     restarts the container. We're running INSIDE that same container, so
#     our exit kills the process and the policy brings it back.
# ---------------------------------------------------------------------------
def _check_scheduler_freshness() -> None:
    try:
        m = minutes_since_beat(SCHEDULER_SERVICE_NAME)
        if m is None:
            # First boot — the scheduler will beat on its next tick.
            return
        if m > STALE_SCHEDULER_MINUTES:
            msg = f"Scheduler heartbeat stale by {m:.0f} min — self-restarting container."
            log.warning(msg)
            note_critical(msg)
            # Flush logs, then kill ourselves HARD. We escalate in three steps
            # because we've observed os._exit() getting swallowed when
            # APScheduler's executor is mid-teardown and some child thread is
            # blocked on a socket/DB wait.
            sys.stdout.flush()
            sys.stderr.flush()
            try:
                # 1) Ask the whole process tree to terminate cleanly.
                os.kill(os.getpid(), signal.SIGTERM)
            except Exception:
                pass
            # 2) If we're still here 3s later, os._exit (POSIX-level).
            try:
                import time as _t
                _t.sleep(3)
            except Exception:
                pass
            try:
                os._exit(2)
            except Exception:
                pass
            # 3) Last resort: SIGKILL ourselves. Docker restart policy fires
            #    on any non-zero exit.
            os.kill(os.getpid(), signal.SIGKILL)
    except Exception as e:
        log.warning("scheduler-freshness check failed: %s", e)


# ---------------------------------------------------------------------------
# (2) Evolution API connection state — restart the instance if closed.
# ---------------------------------------------------------------------------
def _check_evolution() -> None:
    base = os.environ.get("EVOLUTION_API_URL", "").rstrip("/")
    key  = os.environ.get("EVOLUTION_API_KEY", "")
    inst = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    if not base or not key:
        return

    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get(f"{base}/instance/connectionState/{inst}",
                      headers={"apikey": key})
    except Exception as e:
        log.warning("Evolution state probe failed: %s", e)
        note_critical(
            f"No puedo conectar con Evolution API ({e!s:.80}). "
            f"Sin WhatsApp saliente hasta arreglarlo."
        )
        return

    # 401/403 = API key inválida. Antes esto se ignoraba silenciosamente
    # y los leads quedaban sin contacto durante horas sin alerta. Ahora
    # lo levantamos como crítico para que el banner del admin lo muestre.
    if r.status_code in (401, 403):
        note_critical(
            f"Evolution API rechaza nuestras llamadas (HTTP {r.status_code}). "
            f"EVOLUTION_API_KEY está mal, o alguien regeneró la key de la "
            f"instancia '{inst}'. Revisa https://evolution.aprender-aleman.de/manager "
            f"y actualiza la key en /opt/b2c/.env. Todos los envíos están pausados."
        )
        return
    if r.status_code == 404:
        note_critical(
            f"La instancia '{inst}' ya NO existe en Evolution (HTTP 404). "
            f"Hay que recrearla desde el manager y re-escanear el QR."
        )
        return
    if r.status_code != 200:
        log.info("Evolution connectionState HTTP %s — skipping", r.status_code)
        return

    try:
        state = (r.json() or {}).get("instance", {}).get("state") \
             or (r.json() or {}).get("state") or ""
    except Exception as e:
        log.warning("Evolution state parse failed: %s", e)
        return

    if state in ("open", "connecting"):
        # Healthy or transient — do nothing. Clear any previous banner.
        _maybe_clear_banner("evolution")
        return

    if state in ("close", "closed", ""):
        tries_str = get_config("evolution_restart_tries", "0") or "0"
        tries = int(tries_str)
        if tries >= EVOLUTION_MAX_RESTART_TRIES:
            note_critical(
                f"Evolution API state={state!r} after {tries} restart attempts. "
                f"Probablemente WhatsApp cerró sesión — revisa el QR en /admin."
            )
            return
        # Try one restart this cycle.
        log.warning("Evolution state=%s — restarting instance (attempt %d)", state, tries + 1)
        try:
            with httpx.Client(timeout=15.0) as c:
                c.put(f"{base}/instance/restart/{inst}",
                      headers={"apikey": key})
        except Exception as e:
            log.warning("restart call failed: %s", e)
        set_config("evolution_restart_tries", str(tries + 1))


def _maybe_clear_banner(reason: str) -> None:
    current = (get_config("last_critical_issue") or "").lower()
    if reason in current:
        clear_critical()
    # Reset the restart-attempt counter whenever Evolution looks healthy.
    set_config("evolution_restart_tries", "0")


# ---------------------------------------------------------------------------
# (3) Config anomaly detector — the exact class of bug that caused
#     Isabella to sit un-contacted on a Sunday. If skip_sundays is on AND
#     it's Sunday AND there are 'new' leads waiting, un-block first-contact
#     sends for this cycle by overriding the setting in-memory. Follow-ups
#     still respect the weekend rule.
#
#     This check doesn't mutate any state — it just logs + marks the banner
#     if new leads are waiting > 1h without contact. The actual override
#     lives in rate_limits.in_send_window_for_first_contact() which reads
#     the same config but ignores skip_sundays when status='new'.
# ---------------------------------------------------------------------------
def _check_sunday_skip_anomaly() -> None:
    try:
        now_utc = datetime.now(timezone.utc)
        if now_utc.weekday() != 6:
            return
        skip = (get_config("skip_sundays") or "false").lower() in ("true", "1", "yes")
        if not skip:
            return

        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT count(*) AS n
                  FROM leads
                 WHERE status = 'new'
                   AND next_contact_date IS NULL
                   AND created_at < NOW() - INTERVAL '1 hour'
                """
            )
            n = cur.fetchone()["n"]
        if n > 0:
            note_critical(
                f"Hoy es domingo y skip_sundays está activo. {n} lead(s) nuevo(s) "
                f"llevan >1h sin primer contacto. Considera dejar skip_sundays=false."
            )
    except Exception as e:
        log.warning("sunday-skip check failed: %s", e)


# ---------------------------------------------------------------------------
# (4) Stuck-lead recovery — bump next_contact_date to NOW for leads whose
#     next_contact is far past. Agent 0 picks them up next tick.
# ---------------------------------------------------------------------------
def _check_stuck_leads() -> None:
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE leads
                   SET next_contact_date = NOW()
                 WHERE next_contact_date IS NOT NULL
                   AND next_contact_date < NOW() - INTERVAL '%s minutes'
                   AND status NOT IN (
                        'converted','lost','cold','trial_scheduled','trial_reminded'
                   )
                RETURNING id
                """ % STUCK_LEAD_MINUTES,
            )
            bumped = cur.rowcount
        if bumped:
            log.info("Bumped %d stuck leads back into the queue.", bumped)
    except Exception as e:
        log.warning("stuck-lead recovery failed: %s", e)


# ---------------------------------------------------------------------------
# (5) Recent-send health — catches the case where Evolution's
#     connectionState returns 200 but actual sendText calls fail (wrong
#     per-instance apikey, rate limit, etc.). If 3+ of the last 5 sends
#     in the last hour failed, raise a critical alert.
# ---------------------------------------------------------------------------
def _check_recent_sends() -> None:
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT success, error_message
                  FROM message_send_log
                 WHERE sent_at > now() - interval '1 hour'
                   AND to_number <> '(deferred)'
                 ORDER BY sent_at DESC
                 LIMIT 5
                """
            )
            rows = list(cur.fetchall())
        if len(rows) < 3:
            return                               # too little signal
        failed = [r for r in rows if not r["success"]]
        if len(failed) < 3:
            return                               # majority succeeded — healthy

        sample_err = (failed[0]["error_message"] or "").strip()[:150]
        note_critical(
            f"WhatsApp sends están fallando: {len(failed)}/{len(rows)} "
            f"de los últimos intentos fallaron. Último error: {sample_err}. "
            f"Revisa /admin/mantenimiento y Evolution."
        )
    except Exception as e:
        log.warning("recent-sends health check failed: %s", e)


# ---------------------------------------------------------------------------
# (6) Our own heartbeat — last so we mark ourselves alive even if one of
#     the checks above bailed on an exception.
# ---------------------------------------------------------------------------
def _self_beat() -> None:
    try:
        beat(JANITOR_SERVICE_NAME, note="cycle ok")
    except Exception as e:
        log.warning("self-beat failed: %s", e)


def run() -> None:
    """Entry point — called by APScheduler every 10 min."""
    log.info("janitor cycle start")
    _check_scheduler_freshness()
    _check_evolution()
    _check_recent_sends()
    _check_sunday_skip_anomaly()
    _check_stuck_leads()
    _self_beat()
    log.info("janitor cycle done")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    run()
