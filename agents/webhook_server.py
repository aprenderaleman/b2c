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

import hashlib
import hmac
import logging
import os
from typing import Any

import base64
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from agents.agent_4_conversation import handle_incoming_message
from agents.agent_5_guardian import (
    on_calendly_invitee_canceled,
    on_calendly_invitee_created,
)
from agents.shared.db import get_conn
from agents.shared.leads import get_lead_by_phone, log_timeline
from agents.shared.phone import normalize_phone

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
# Calendly
# ──────────────────────────────────────────────────────────

_CALENDLY_SIGNING_KEY = os.environ.get("CALENDLY_WEBHOOK_SIGNING_KEY", "")


def _verify_calendly_signature(raw_body: bytes, header: str) -> bool:
    """
    Calendly v2 signature header looks like:
        t=1234567890,v1=<hex>
    The signed payload is `<t>.<raw_body>`.
    """
    if not _CALENDLY_SIGNING_KEY:
        log.warning("CALENDLY_WEBHOOK_SIGNING_KEY not set — skipping signature check.")
        return True
    if not header:
        return False
    parts = dict(part.split("=", 1) for part in header.split(",") if "=" in part)
    t = parts.get("t")
    v1 = parts.get("v1")
    if not t or not v1:
        return False
    signed = f"{t}.".encode() + raw_body
    digest = hmac.new(_CALENDLY_SIGNING_KEY.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, v1)


@app.post("/webhook/calendly")
async def calendly_webhook(
    request: Request,
    calendly_webhook_signature: str | None = Header(default=None),
):
    raw = await request.body()
    if not _verify_calendly_signature(raw, calendly_webhook_signature or ""):
        raise HTTPException(status_code=401, detail="invalid signature")

    payload = await request.json()
    event = payload.get("event") or ""
    try:
        if event == "invitee.created":
            lead_id = on_calendly_invitee_created(payload)
        elif event == "invitee.canceled":
            lead_id = on_calendly_invitee_canceled(payload)
        else:
            log.info("Ignoring Calendly event: %s", event)
            return JSONResponse({"ok": True, "ignored": event})
    except Exception:
        log.exception("Calendly handler failed")
        raise HTTPException(status_code=500, detail="handler error")

    return JSONResponse({"ok": True, "lead_id": str(lead_id) if lead_id else None})


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
    import json as _json
    data = payload.get("data") or payload
    key = data.get("key") or {}
    remote_jid = key.get("remoteJid") or ""
    sender_pn = (
        data.get("sender")
        or key.get("senderPn")
        or key.get("participantPn")
        or ""
    )
    log.info("WA msg: jid=%r sender=%r fromMe=%r", remote_jid, sender_pn, key.get("fromMe"))
    if not key.get("fromMe"):
        # Full payload dump on inbound so we can see what Evolution gives us for
        # @lid→phone mapping.  Remove once inbound is reliably handled.
        log.info("inbound raw: %s", _json.dumps({k: v for k, v in data.items() if k != 'message'}, default=str)[:1200])

    if key.get("fromMe"):
        return  # ignore our own outbound echoes
    if "@g.us" in remote_jid:
        return  # group chats — not supported

    # Prefer the actual phone (senderPn) over LID/JID. WhatsApp's newer "@lid"
    # format doesn't identify by phone number, so we fall back through options.
    raw_phone = ""
    if sender_pn:
        raw_phone = sender_pn.split("@", 1)[0]
    if not raw_phone:
        raw_phone = remote_jid.split("@", 1)[0]
    if not raw_phone.startswith("+"):
        raw_phone = "+" + raw_phone
    try:
        normalized = normalize_phone(raw_phone)
    except ValueError:
        log.warning("Received message with un-normalizable phone: %r", raw_phone)
        return

    # Extract text body (Evolution nests it in message.conversation or extendedTextMessage.text)
    msg = data.get("message") or {}
    text = (
        msg.get("conversation")
        or (msg.get("extendedTextMessage") or {}).get("text")
        or (msg.get("imageMessage") or {}).get("caption")
        or ""
    ).strip()

    lead = get_lead_by_phone(normalized)
    if not lead:
        log.info("Inbound WhatsApp from unknown number %s — ignoring.", normalized)
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
