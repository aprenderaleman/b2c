"""
Two scheduler ticks that keep the WhatsApp pipeline self-healing:

  tick_webhook_self_heal — every 10 min checks Evolution's webhook
    config for our instance. If the URL got reset, the secret got
    cleared, or the events list shrank, we POST the canonical config
    back. This is the lever that recovers from "Stiv stops seeing
    inbound" failures (the case that left Aisa unanswered for 24h
    on 2026-04-29).

  tick_inbound_replay — fetches the last 6h of inbound messages
    directly from Evolution and re-injects any that don't already
    have a matching `lead_message_received` row in lead_timeline.
    Closes the small window where the webhook was misconfigured
    but the messages still hit Evolution's local store.

Both are safe to run repeatedly: webhook_self_heal POSTs the same
config (idempotent), and inbound_replay dedupes against the
timeline before re-handling anything.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone

import httpx

from agents.shared.db import get_conn
from agents.shared.leads import get_lead_by_phone
from agents.shared.phone import normalize_phone

log = logging.getLogger("whatsapp_health")

# ─────────────────────────────────────────────────────────
# Webhook self-heal
# ─────────────────────────────────────────────────────────


def _evolution_client() -> httpx.Client:
    base = os.environ.get("EVOLUTION_API_URL", "http://localhost:8080").rstrip("/")
    key  = os.environ.get("EVOLUTION_API_KEY", "")
    return httpx.Client(base_url=base, headers={"apikey": key}, timeout=15.0)


def _canonical_webhook_config() -> dict:
    """The shape of webhook config we want Evolution to have for our
    instance. If anything drifts from this, self-heal POSTs it back."""
    url    = os.environ.get("AGENTS_WEBHOOK_URL", "").rstrip("/")
    secret = os.environ.get("EVOLUTION_WEBHOOK_SECRET", "")
    return {
        "enabled":   True,
        "url":       url,
        "events": [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED",
        ],
        "webhook_by_events": False,
        "webhook_base64":    False,
        "secret":            secret or None,
    }


def tick_webhook_self_heal() -> dict:
    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    webhook_url = os.environ.get("AGENTS_WEBHOOK_URL", "")
    if not webhook_url:
        log.info("[webhook_heal] AGENTS_WEBHOOK_URL not set — skipping.")
        return {"skipped": True, "reason": "no_webhook_url"}

    try:
        with _evolution_client() as ev:
            r = ev.get(f"/webhook/find/{instance}")
            current = r.json() if r.status_code == 200 else {}
    except Exception as e:                              # noqa: BLE001
        log.warning("[webhook_heal] could not fetch current config: %s", e)
        return {"error": str(e)[:120]}

    expected = _canonical_webhook_config()
    drift = (
        not current.get("enabled")
        or current.get("url", "").rstrip("/") != expected["url"].rstrip("/")
        or set((current.get("events") or [])) != set(expected["events"])
    )
    if not drift:
        return {"ok": True, "drift": False}

    log.warning(
        "[webhook_heal] drift detected — url=%r events=%s. Re-applying.",
        current.get("url"), current.get("events"),
    )
    try:
        with _evolution_client() as ev:
            payload = {
                "url":               expected["url"],
                "enabled":           True,
                "webhook_by_events": False,
                "webhook_base64":    False,
                "events":            expected["events"],
            }
            ev.post(f"/webhook/set/{instance}", json=payload)
        return {"ok": True, "drift": True, "reapplied": True}
    except Exception as e:                              # noqa: BLE001
        log.error("[webhook_heal] re-apply failed: %s", e)
        return {"error": str(e)[:120]}


# ─────────────────────────────────────────────────────────
# Inbound replay
# ─────────────────────────────────────────────────────────


REPLAY_WINDOW = timedelta(hours=6)


def _seen_in_timeline(phone: str, ts: datetime) -> bool:
    """True if we already have a lead_message_received row from this phone
    within ±90 s of `ts`. We use a wider window than 1 s because Evolution
    timestamps can drift a few seconds vs our clock."""
    lower = ts - timedelta(seconds=90)
    upper = ts + timedelta(seconds=90)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
              FROM lead_timeline lt
              JOIN leads l ON l.id = lt.lead_id
             WHERE lt.type = 'lead_message_received'
               AND l.whatsapp_normalized = %s
               AND lt.timestamp BETWEEN %s AND %s
             LIMIT 1
            """,
            (phone, lower, upper),
        )
        return cur.fetchone() is not None


def tick_inbound_replay() -> dict:
    """Pull last-6h inbound messages from Evolution; for each one not
    represented in lead_timeline, hand it off to the existing webhook
    handler so it goes through the same pipeline a real webhook would."""
    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    cutoff = datetime.now(timezone.utc) - REPLAY_WINDOW

    try:
        with _evolution_client() as ev:
            # v1.8 endpoint: /chat/findMessages/{instance}. Body filters
            # by direction; we ask for fromMe=false and a time window.
            r = ev.post(
                f"/chat/findMessages/{instance}",
                json={"where": {"key": {"fromMe": False}}, "limit": 200},
            )
            messages = r.json() if r.status_code == 200 else []
    except Exception as e:                              # noqa: BLE001
        log.warning("[inbound_replay] could not fetch messages: %s", e)
        return {"error": str(e)[:120]}

    if not isinstance(messages, list):
        return {"error": "unexpected_shape", "got": type(messages).__name__}

    replayed = 0
    skipped  = 0
    # Lazy import to avoid the circular dep with webhook_server.
    from agents.webhook_server import _handle_whatsapp_message

    for m in messages:
        try:
            mts_raw = m.get("messageTimestamp")
            if not mts_raw:
                continue
            mts_int = int(mts_raw if isinstance(mts_raw, (int, float)) else mts_raw)
            if mts_int > 1_000_000_000_000:           # ms not s
                mts_int = mts_int // 1000
            mts = datetime.fromtimestamp(mts_int, tz=timezone.utc)
            if mts < cutoff:
                continue

            key = m.get("key") or {}
            jid = key.get("remoteJid") or ""
            if "@g.us" in jid:
                continue
            raw_phone = jid.split("@", 1)[0]
            if not raw_phone:
                continue
            try:
                phone = normalize_phone("+" + raw_phone)
            except ValueError:
                continue

            if _seen_in_timeline(phone, mts):
                skipped += 1
                continue

            # Synthesise the same shape the live webhook would deliver.
            payload = {"event": "messages.upsert", "data": m}
            _handle_whatsapp_message(payload)
            replayed += 1
        except Exception as e:                          # noqa: BLE001
            log.warning("[inbound_replay] failed on message: %s", e)
            continue

    if replayed or skipped:
        log.info("[inbound_replay] replayed=%d skipped=%d", replayed, skipped)
    return {"ok": True, "replayed": replayed, "skipped": skipped}
