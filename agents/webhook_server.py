"""
Webhook server — FastAPI app.

Two endpoints:

    POST /webhook/calendly   — Calendly v2 webhook (invitee.created/canceled)
    POST /webhook/whatsapp   — Evolution API event webhook (messages in,
                               status changes, read receipts)

Also exposes:
    GET  /healthz            — liveness probe

Run locally:
    python -m agents.webhook_server

Runs in production as systemd unit `aa-agents.service` (see deploy_vps.sh).
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Any

import base64
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from agents.agent_4_conversation import handle_incoming_message
from agents.shared.db import get_conn
from agents.shared.leads import get_lead_by_phone, log_timeline
from agents.shared.phone import normalize_phone
from agents.whatsapp_service import WhatsAppError, WhatsAppService

# In-memory store for the latest QR (per instance).
# Evolution regenerates QRs every ~30s while pairing; we keep the latest.
_QR_LATEST: dict[str, bytes] = {}

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("webhook_server")

app = FastAPI(title="Aprender-Aleman.de — Agents webhook server")


@app.get("/healthz")
async def healthz():
    return {"ok": True}


# ──────────────────────────────────────────────────────────
# QR viewer (guarded by shared secret so it's not public)
# ──────────────────────────────────────────────────────────

@app.get("/qr/{instance}/png")
async def qr_png(instance: str, token: str = ""):
    if token != os.environ.get("QR_VIEWER_TOKEN", ""):
        raise HTTPException(status_code=401, detail="invalid token")
    png = _QR_LATEST.get(instance)
    if not png:
        raise HTTPException(status_code=404, detail="no QR yet — wait for Evolution to send one")
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "no-store"})


@app.get("/qr/{instance}")
async def qr_html(instance: str, token: str = ""):
    if token != os.environ.get("QR_VIEWER_TOKEN", ""):
        raise HTTPException(status_code=401, detail="invalid token")
    # Auto-refresh every 5s so the page picks up new QRs as Evolution rotates.
    html = f"""<!doctype html><html lang="es"><head>
<meta charset="utf-8"><title>WhatsApp QR — Aprender-Aleman.de</title>
<meta http-equiv="refresh" content="5">
<style>
  body {{ font-family: system-ui, sans-serif; display:flex; align-items:center;
         justify-content:center; min-height:100vh; margin:0;
         background: linear-gradient(135deg,#FFF7ED,#FED7AA); }}
  .box {{ background:white; padding:2rem 3rem; border-radius:20px;
         box-shadow:0 16px 48px rgba(0,0,0,.12); text-align:center; max-width:420px; }}
  h1 {{ color:#F97316; margin-top:0; }}
  img {{ width: 320px; height: 320px; image-rendering: pixelated; }}
  .hint {{ color:#475569; font-size:14px; }}
  .small {{ color:#94a3b8; font-size:12px; margin-top:1.5rem; }}
  .btn {{ display:inline-block; margin-top:.8rem; padding:.5rem 1rem;
         border-radius:999px; background:#F97316; color:white; text-decoration:none;
         font-weight:600; font-size:14px; }}
</style></head><body>
<div class=box>
  <h1>Escanea con WhatsApp</h1>
  <p class=hint>WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo</p>
  <img src="/qr/{instance}/png?token={token}" alt="QR"/>
  <p class=small>La página se refresca cada 5 segundos.<br>
  El QR caduca cada ~30 s y Evolution genera uno nuevo.</p>
</div>
</body></html>"""
    return HTMLResponse(content=html)


# ──────────────────────────────────────────────────────────
# Calendly — DEPRECATED. The self-book funnel replaced Calendly
# entirely. We respond 410 Gone to any residual webhook traffic
# so Calendly retries don't hammer a real handler.
# ──────────────────────────────────────────────────────────

@app.post("/webhook/calendly")
async def calendly_webhook_deprecated():
    log.warning("Calendly webhook hit but Calendly is deprecated. Returning 410.")
    raise HTTPException(status_code=410, detail="calendly_deprecated")


# ──────────────────────────────────────────────────────────
# WhatsApp (Evolution API)
# ──────────────────────────────────────────────────────────

_EVOLUTION_WEBHOOK_SECRET = os.environ.get("EVOLUTION_WEBHOOK_SECRET", "")


@app.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request):
    # Evolution can be configured to send a shared secret in a header; if
    # you set EVOLUTION_WEBHOOK_SECRET, we require it to match.
    if _EVOLUTION_WEBHOOK_SECRET:
        got = request.headers.get("X-Webhook-Secret") or request.headers.get("apikey")
        if got != _EVOLUTION_WEBHOOK_SECRET:
            raise HTTPException(status_code=401, detail="invalid secret")

    payload = await request.json()
    event = payload.get("event") or payload.get("type") or ""
    log.info("WA webhook event=%r payload_keys=%s", event, list(payload.keys())[:8])

    try:
        if event in ("messages.upsert", "MESSAGES_UPSERT"):
            _handle_whatsapp_message(payload)
        elif event in ("messages.update", "MESSAGES_UPDATE"):
            _handle_whatsapp_status_update(payload)
        elif event in ("connection.update", "CONNECTION_UPDATE"):
            _handle_connection_update(payload)
        elif event in ("qrcode.updated", "QRCODE_UPDATED"):
            _handle_qrcode_updated(payload)
        else:
            log.info("Ignoring Evolution event: %s", event)
    except Exception:
        log.exception("WhatsApp handler failed")
        # Evolution retries on non-2xx — we log & swallow to avoid storm.
        return JSONResponse({"ok": False, "error": "handler error"}, status_code=200)

    return JSONResponse({"ok": True})


def _handle_whatsapp_message(payload: dict[str, Any]) -> None:
    data = payload.get("data") or payload
    key = data.get("key") or {}
    remote_jid = key.get("remoteJid") or ""
    sender_pn = (
        data.get("sender")
        or key.get("senderPn")
        or key.get("participantPn")
        or ""
    )
    push_name = data.get("pushName") or ""
    log.info("WA msg: jid=%r sender=%r fromMe=%r push=%r",
             remote_jid, sender_pn, key.get("fromMe"), push_name)

    if key.get("fromMe"):
        return  # ignore our own outbound echoes
    if "@g.us" in remote_jid:
        return  # group chats — not supported

    # Resolve the lead. Three strategies in order:
    #   1. JID is '@s.whatsapp.net' → extract phone, normalize, lookup by phone.
    #   2. JID is '@lid' → lookup by stored lid column first.
    #   3. Fall back to matching by pushName (strip the '~' prefix WhatsApp
    #      adds for non-contacts). Persist the LID on first match so future
    #      messages from the same user route directly.
    lead = None
    is_lid = remote_jid.endswith("@lid")
    if not is_lid:
        # Prefer senderPn, then the raw JID
        raw_phone = (sender_pn.split("@", 1)[0] if sender_pn
                     else remote_jid.split("@", 1)[0])
        if raw_phone and not raw_phone.startswith("+"):
            raw_phone = "+" + raw_phone
        try:
            normalized = normalize_phone(raw_phone)
            lead = get_lead_by_phone(normalized)
        except ValueError:
            log.warning("Un-normalizable phone: %r", raw_phone)
            return
    else:
        lead = _resolve_lead_for_lid(remote_jid, push_name)

    # Extract text body (Evolution nests it in message.conversation or extendedTextMessage.text)
    msg = data.get("message") or {}
    text = (
        msg.get("conversation")
        or (msg.get("extendedTextMessage") or {}).get("text")
        or (msg.get("imageMessage") or {}).get("caption")
        or ""
    ).strip()

    if not lead:
        log.info("Inbound WhatsApp unmatched — jid=%r push=%r — ignoring.",
                 remote_jid, push_name)
        return

    if not text:
        # Non-text message (audio, image w/o caption, etc.) — escalate.
        log_timeline(
            lead["id"],
            type="lead_message_received",
            author="lead",
            content="(non-text message — needs human)",
        )
        return

    handle_incoming_message(lead, text)


def _resolve_lead_for_lid(remote_jid: str, push_name: str) -> dict | None:
    """
    Resolve a lead from an '@lid'-style remoteJid.

    1. If we've already linked this LID to a lead, look it up directly.
    2. Otherwise match by pushName (case-insensitive, stripping the '~'
       prefix that WhatsApp adds for contacts not in the user's phonebook).
       On a *unique* match, persist the LID on the lead for future O(1)
       lookups.
    3. Ambiguous name (multiple matches) or no match → None.
    """
    # 1. Direct LID lookup
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM leads WHERE whatsapp_lid = %s",
            (remote_jid,),
        )
        row = cur.fetchone()
        if row:
            return dict(row)

    # 2. pushName-based fallback — only helpful if the lead supplied their
    # name on the funnel and it matches the WhatsApp profile.
    clean = (push_name or "").lstrip("~").strip()
    if not clean:
        return None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM leads
             WHERE status NOT IN ('lost','cold','converted')
               AND (whatsapp_lid IS NULL OR whatsapp_lid = %s)
               AND (
                     lower(name) = lower(%s)
                  OR lower(name) LIKE lower(%s)
                  OR lower(%s) LIKE lower(name) || ' %%'
               )
             ORDER BY created_at DESC
             LIMIT 2
            """,
            (remote_jid, clean, clean.split()[0] + " %", clean),
        )
        rows = list(cur.fetchall())

    if len(rows) == 1:
        lead = dict(rows[0])
        # Persist the LID so next time we skip the name match.
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE leads SET whatsapp_lid = %s WHERE id = %s",
                (remote_jid, lead["id"]),
            )
        log.info("LID %s bound to lead %s (%s) by pushName match.",
                 remote_jid, lead["id"], lead["name"])
        return lead

    if len(rows) > 1:
        log.warning("Ambiguous pushName %r — %d candidate leads; ignoring.",
                    clean, len(rows))
    return None


def _handle_whatsapp_status_update(payload: dict[str, Any]) -> None:
    """Track read receipts so Agent 0 knows whether to continue past contact 3."""
    data = payload.get("data") or payload
    status = (data.get("status") or "").lower()
    key = data.get("key") or {}
    remote_jid = key.get("remoteJid") or ""
    if not remote_jid:
        return
    raw_phone = remote_jid.split("@", 1)[0]
    try:
        normalized = normalize_phone("+" + raw_phone if not raw_phone.startswith("+") else raw_phone)
    except ValueError:
        return

    if status in ("read", "read_self", "played"):
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE leads
                   SET messages_seen_count = messages_seen_count + 1,
                       last_message_seen_at = NOW()
                 WHERE whatsapp_normalized = %s
                """,
                (normalized,),
            )


def _handle_connection_update(payload: dict[str, Any]) -> None:
    """If the WhatsApp instance disconnects, record it so Gelfis sees the warning."""
    data = payload.get("data") or payload
    state = data.get("state") or data.get("connection") or ""
    log.info("Evolution connection state: %s", state)
    # Future: if state == 'close' for > N minutes, notify Gelfis.


def _handle_qrcode_updated(payload: dict[str, Any]) -> None:
    """
    Evolution sends a fresh QR every ~30 s while an instance is pairing.
    We cache the latest one in memory so `/qr/{instance}` can render it.
    """
    data = payload.get("data") or payload
    inst = payload.get("instance") or data.get("instance") or "aprender-aleman-main"
    if isinstance(inst, dict):
        inst = inst.get("instanceName") or "aprender-aleman-main"

    qr = (
        data.get("base64")
        or data.get("qrcode")
        or data.get("code")
    )
    if isinstance(qr, dict):
        qr = qr.get("base64") or qr.get("code")
    if not qr:
        log.info("QR event without base64 payload (keys=%s)", list(data.keys()) if isinstance(data, dict) else "?")
        return
    raw = qr.split(",", 1)[1] if isinstance(qr, str) and qr.startswith("data:") else qr
    try:
        png = base64.b64decode(raw)
    except Exception as e:  # noqa: BLE001
        log.warning("QR decode failed: %s", e)
        return
    _QR_LATEST[inst] = png
    log.info("QR cached for instance %s (%d bytes)", inst, len(png))


# ──────────────────────────────────────────────────────────
# Internal endpoint — called from Vercel (web app) to send one-off
# WhatsApp messages (welcome, notifications, etc.) without giving
# Vercel direct access to Evolution API.
# ──────────────────────────────────────────────────────────


@app.post("/internal/send-text")
async def internal_send_text(request: Request):
    """
    POST body: {"phone": "+4915...", "text": "..."}
    Auth: X-Internal-Secret header must match AGENTS_INTERNAL_SECRET env.
    """
    expected = os.environ.get("AGENTS_INTERNAL_SECRET")
    if not expected:
        raise HTTPException(status_code=503, detail="internal_secret_not_configured")

    provided = request.headers.get("x-internal-secret")
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="unauthorized")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_json")

    phone = (body.get("phone") or "").strip()
    text  = (body.get("text")  or "").strip()
    if not phone or not text:
        raise HTTPException(status_code=400, detail="missing_phone_or_text")

    # Normalize / sanity-check the phone.
    try:
        normalized = normalize_phone(phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid_phone:{e}")

    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    wa = WhatsAppService()

    try:
        message_id = wa.send_text(instance, normalized, text)
    except WhatsAppError as e:
        log.warning("internal/send-text failed: %s", e)
        raise HTTPException(status_code=502, detail=f"whatsapp_error:{e}")

    # Best-effort timeline log (so the message shows up under the lead's
    # history if it matches). If there's no lead row this silently skips.
    # Author MUST be one of the timeline_author enum values — using "web"
    # here used to silently violate the enum and the broad except below
    # would swallow it, leaving no WhatsApp row in /admin/leads/{id}.
    try:
        lead = get_lead_by_phone(normalized)
        if lead:
            log_timeline(
                lead["id"],
                type="system_message_sent",
                author="system",
                content=f"💬 WhatsApp enviado: {text[:200]}",
                metadata={"trigger": "internal_send_text", "message_id": message_id},
            )
    except Exception as e:
        log.warning("timeline log on /internal/send-text failed: %s", e)

    return {"ok": True, "messageId": message_id}


# ──────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────

def main() -> None:
    uvicorn.run(
        "agents.webhook_server:app",
        host=os.environ.get("WEBHOOK_HOST", "0.0.0.0"),
        port=int(os.environ.get("WEBHOOK_PORT", "8000")),
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":
    main()
