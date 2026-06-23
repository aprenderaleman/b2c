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
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from agents.agent_4_conversation import handle_incoming_message
from agents.shared.db import get_conn
from agents.shared.leads import get_lead_by_phone, log_timeline
from agents.shared.phone import normalize_phone
from agents.whatsapp_service import WhatsAppError, WhatsAppService

try:
    from psycopg.errors import UniqueViolation       # psycopg v3
except Exception:                                     # noqa: BLE001
    try:
        from psycopg2.errors import UniqueViolation  # psycopg2 fallback
    except Exception:                                 # noqa: BLE001
        UniqueViolation = Exception                   # type: ignore[misc,assignment]

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


def _claim_inbound(msg_id: str) -> bool:
    """
    Atomic dedup: try to INSERT this WhatsApp message_id into inbound_dedup.
    Returns True if we got the lock (first time this id is seen) →
    proceed with processing. Returns False if it was already there →
    skip processing, this is a retry from Evolution.

    Fail-open on unexpected errors: better to risk a duplicate than miss
    a real message.
    """
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO inbound_dedup (wa_message_id) VALUES (%s)",
                (msg_id,),
            )
        return True
    except UniqueViolation:
        return False
    except Exception:                                       # noqa: BLE001
        log.exception("inbound_dedup claim failed for %s — failing open", msg_id)
        return True


def _dispatch_event(event: str, payload: dict[str, Any]) -> None:
    """Background worker. Runs AFTER the 200 has been returned to Evolution
    so the handler can take the 30-90s of compose+review+delay+send without
    Evolution's webhook timeout retrying the same message.

    Para messages.upsert: la resolución del lead + parseo del texto es
    rápido (<1s). Si el lead se resuelve, encolamos la tarea de procesar
    (Agent 4 + send) en `inbound_processing_queue` para que un cron retry-e
    si BackgroundTasks crashea o hay timeout en Anthropic. Esto cubre el
    caso Christian 2026-04-30: Ja+No responde llegaron pero la respuesta
    nunca salió (probablemente background task murió silenciosamente)."""
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
    except Exception:                                       # noqa: BLE001
        log.exception("WhatsApp background handler failed")


def _enqueue_for_processing(lead_id: str, text: str, wa_message_id: str | None) -> None:
    """Persiste el inbound resuelto en inbound_processing_queue. El
    drainer retry-eará hasta 3 veces si Agent 4 falla."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO inbound_processing_queue
                  (lead_id, text, wa_message_id, status)
                VALUES (%s, %s, %s, 'pending')
                """,
                (lead_id, text, wa_message_id),
            )
    except Exception:                                       # noqa: BLE001
        log.exception("could not enqueue inbound — falling back to inline processing")


def _mark_queue_done(lead_id: str, text: str) -> None:
    """Marca como done la fila pending más reciente que matchea (lead, text)."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE inbound_processing_queue
                   SET status = 'done', last_attempt_at = NOW()
                 WHERE id = (
                     SELECT id FROM inbound_processing_queue
                      WHERE lead_id = %s AND text = %s
                        AND status IN ('pending','processing')
                      ORDER BY queued_at DESC LIMIT 1
                 )
                """,
                (lead_id, text),
            )
    except Exception:                                       # noqa: BLE001
        log.exception("could not mark queue done")


@app.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request, background: BackgroundTasks):
    # Evolution can be configured to send a shared secret in a header; if
    # you set EVOLUTION_WEBHOOK_SECRET, we require it to match.
    if _EVOLUTION_WEBHOOK_SECRET:
        got = request.headers.get("X-Webhook-Secret") or request.headers.get("apikey")
        if got != _EVOLUTION_WEBHOOK_SECRET:
            raise HTTPException(status_code=401, detail="invalid secret")

    payload = await request.json()
    event = payload.get("event") or payload.get("type") or ""

    # Idempotency: each Evolution `messages.upsert` has a unique key.id.
    # If Evolution times out on us and retries, the same key.id arrives
    # again. We claim it atomically; on the second attempt the INSERT
    # fails with UniqueViolation and we return 200 without doing the
    # work twice. (Caso Christian Moresi 2026-04-29: retry generó 3
    # respuestas IA idénticas.)
    if event in ("messages.upsert", "MESSAGES_UPSERT"):
        data = payload.get("data") or payload
        key  = data.get("key") or {}
        msg_id = key.get("id")
        if msg_id and not _claim_inbound(msg_id):
            log.info("Duplicate inbound key.id=%r — Evolution retry, ignoring.", msg_id)
            return JSONResponse({"ok": True, "duplicate": True})

    log.info("WA webhook event=%r payload_keys=%s", event, list(payload.keys())[:8])

    # Schedule processing in background. Returns 200 in <100ms so Evolution
    # never times out and never retries.
    background.add_task(_dispatch_event, event, payload)
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
        # JID @lid: WhatsApp asigna esto a usuarios fuera de la libreta de
        # contactos del business. Tres estrategias en orden:
        #   1. Match por whatsapp_lid ya guardado.
        #   2. Match por pushName (case-insensitive, fuzzy).
        #   3. Fallback NUEVO 2026-06-16: Evolution v2 a veces entrega el
        #      telefono real en data.sender / key.senderPn aunque el JID
        #      sea @lid. Si lo tenemos, normalizamos y buscamos por
        #      telefono. Si matchea, ademas persistimos el LID en
        #      leads.whatsapp_lid para que los futuros mensajes vayan
        #      por la ruta 1 (O(1)).
        #
        # Bug Tomas/Barbara 2026-06-16: respondieron "CONFIRMO" desde @lid,
        # su pushName no coincidia exactamente con leads.name, y como no
        # habia fallback por telefono el handler descartaba en silencio
        # bajo la politica de "ignorar unmatched".
        lead = _resolve_lead_for_lid(remote_jid, push_name)
        if not lead and sender_pn:
            raw_phone = sender_pn.split("@", 1)[0]
            if raw_phone and not raw_phone.startswith("+"):
                raw_phone = "+" + raw_phone
            try:
                normalized = normalize_phone(raw_phone)
                lead = get_lead_by_phone(normalized)
                if lead:
                    log.info("LID inbound matched via senderPn fallback — "
                             "persisting lid=%r on lead=%s", remote_jid, lead["id"])
                    try:
                        with get_conn() as conn, conn.cursor() as cur:
                            cur.execute(
                                "UPDATE leads SET whatsapp_lid=%s "
                                "WHERE id=%s AND (whatsapp_lid IS NULL OR whatsapp_lid='')",
                                (remote_jid, lead["id"]),
                            )
                    except Exception:                          # noqa: BLE001
                        log.exception("failed to persist whatsapp_lid")
            except ValueError:
                log.warning("LID senderPn un-normalizable: %r", raw_phone)

    # Extract text body (Evolution nests it in message.conversation or extendedTextMessage.text)
    msg = data.get("message") or {}
    text = (
        msg.get("conversation")
        or (msg.get("extendedTextMessage") or {}).get("text")
        or (msg.get("imageMessage") or {}).get("caption")
        or ""
    ).strip()

    if not lead:
        # POLÍTICA Gelfis 2026-05-04: el WhatsApp de la academia
        # (+4915253409644) recibe mensajes de muchas personas que NO son
        # leads — familia, amigos, vendedores, números equivocados. Si
        # no hay match exacto contra `leads.whatsapp_normalized` o
        # `leads.whatsapp_lid`, IGNORAMOS en silencio. No reply, no
        # timeline, no unmatched_inbounds. La heurística previa de
        # "asociar al lead con outbound más reciente" causaba cross-
        # contaminación de mensajes — ver
        # _resolve_by_recent_outbound (eliminada).
        log.info("Inbound WhatsApp unmatched — jid=%r push=%r — silently ignored.",
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

    # Encolar para procesamiento durable + procesar inline. Si el inline
    # falla (timeout Anthropic, etc.), el cron _drain_inbound_queue lo
    # retomará. Si el inline tiene éxito, marca la fila como 'done'.
    msg_id = key.get("id")
    _enqueue_for_processing(lead["id"], text, msg_id)
    try:
        handle_incoming_message(lead, text)
        # Marcar la fila más reciente para este lead+text como done
        _mark_queue_done(lead["id"], text)
    except Exception:                                       # noqa: BLE001
        log.exception("inline inbound processing failed — queue will retry")


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

    # ELIMINADO 2026-05-04 — `_resolve_by_recent_outbound` adivinaba
    # el lead por "outbound más reciente" cuando no había match por
    # teléfono ni por LID. Causaba cross-contaminación: mensajes de
    # personas no-lead (familia, vendedores, etc.) se asociaban al
    # lead que casualmente acababa de recibir un mensaje. Ver
    # incidente Abel Alonso Garcia (+41772771069). Política nueva:
    # si no hay match exacto, devolvemos None y el caller ignora
    # en silencio.
    return None


def _record_unmatched(remote_jid: str, push_name: str, text: str,
                       candidates_summary: str = "") -> None:
    """DEPRECATED 2026-05-04 — ya no se llama desde el webhook. Antes
    registraba inbounds no resueltos para revisión manual; ahora la
    política es ignorar silenciosamente cualquier inbound que no
    machee por teléfono o LID exacto. Función conservada por si en el
    futuro queremos un panel "rebotes" — borrar después de validar
    que no la necesitamos."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO unmatched_inbounds
                  (jid, push_name, content_preview, candidates)
                VALUES (%s, %s, %s, %s)
                """,
                (remote_jid, push_name[:200], (text or "")[:300],
                 candidates_summary[:500] or None),
            )
    except Exception as e:                              # noqa: BLE001
        log.warning("could not record unmatched_inbound: %s", e)


def _resolve_by_recent_outbound(remote_jid: str) -> dict | None:
    """DEPRECATED 2026-05-04 — ELIMINADA del flow porque adivinaba el
    lead por "outbound más reciente" cuando llegaba un LID nuevo,
    causando que mensajes de personas no-lead se asociaran al lead que
    casualmente había recibido el último outbound. Ver incidente Abel
    Alonso Garcia (+41772771069). Función conservada como referencia;
    no la llames desde nuevo código."""
    # Ventana 6h: cubre el caso "lead respondió varias horas después" o
    # "el sistema replaya un msg viejo". El TOP 1 más reciente sin LID es
    # el candidato más probable. Si hay ambigüedad logamos warning.
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (l.id) l.*, msl.sent_at AS last_outbound
              FROM message_send_log msl
              JOIN leads l ON l.whatsapp_normalized = msl.to_number
             WHERE msl.success = TRUE
               AND msl.sent_at > NOW() - INTERVAL '6 hours'
               AND l.whatsapp_lid IS NULL
               AND l.status NOT IN ('lost','converted')
             ORDER BY l.id, msl.sent_at DESC
            """
        )
        rows = sorted(list(cur.fetchall()), key=lambda r: r["last_outbound"], reverse=True)

    if not rows:
        return None

    # Si solo un lead es candidato → match unívoco.
    distinct_ids = {r["id"] for r in rows}
    if len(distinct_ids) == 1:
        lead = dict(rows[0])
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE leads SET whatsapp_lid = %s WHERE id = %s",
                (remote_jid, lead["id"]),
            )
        log.info("LID %s bound to lead %s (%s) by recent-outbound correlation.",
                 remote_jid, lead["id"], lead["name"])
        return lead

    # Múltiples candidatos → tomar el MÁS reciente (mejor heurística que random).
    # Loguear los otros para que Gelfis sepa si hay riesgo de cruce.
    lead = dict(rows[0])
    others = [f"{r['name']}({r['whatsapp_normalized']})" for r in rows[1:]]
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE leads SET whatsapp_lid = %s WHERE id = %s",
            (remote_jid, lead["id"]),
        )
    log.warning("LID %s tied to lead %s (%s) by recent-outbound — also recent: %s.",
                remote_jid, lead["id"], lead["name"], ", ".join(others))
    return lead


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
    # Optional metadata so the retry queue can label the row + write
    # a meaningful send_failed timeline event if the lead is known.
    kind     = (body.get("kind") or "manual")[:60]
    lead_id  = (body.get("lead_id") or None)
    if not phone or not text:
        raise HTTPException(status_code=400, detail="missing_phone_or_text")

    try:
        normalized = normalize_phone(phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid_phone:{e}")

    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    wa = WhatsAppService()

    # ─── PAUSA GLOBAL ─────────────────────────────────────────────
    # Si Gelfis (o el auto-detect) activó `system_paused_until`
    # en BD, paramos todos los envios hasta que pase la pausa. Esto
    # nos permite absorber un ban de 5h sin que los crons sigan
    # disparando contra Evolution (lo que extiende el ban).
    try:
        from agents.shared.db import get_config
        pause_until = get_config("system_paused_until")
        if pause_until:
            import datetime
            try:
                p = datetime.datetime.fromisoformat(pause_until.replace("Z", "+00:00"))
                now = datetime.datetime.now(p.tzinfo or datetime.timezone.utc)
                if p > now:
                    log.warning("[paused] system_paused_until=%s — skipping send to %s", pause_until, normalized)
                    raise HTTPException(status_code=503, detail=f"system_paused_until:{pause_until}")
            except (ValueError, TypeError):
                pass
    except HTTPException: raise
    except Exception as e:                                       # noqa: BLE001
        log.warning("[paused] config check failed (continuing): %s", e)

    # ─── PRE-CHECK exists ─────────────────────────────────────────
    # Causa #1 documentada del ban de 5h: enviar a numeros que NO
    # tienen WhatsApp. Evolution registra el intento y WhatsApp lo
    # cuenta como spam. Validamos antes de enviar. Si no existe,
    # devolvemos 410 (Gone) — el caller puede marcar lead.has_wa=false
    # y dejar de intentar. Cache positivo durante 24h para no
    # multiplicar las llamadas (idempotente, exists no cambia rapido).
    try:
        if not _exists_on_whatsapp_cached(wa, instance, normalized):
            log.warning("[no_wa] %s no tiene WhatsApp — NO se manda", normalized)
            raise HTTPException(status_code=410, detail="number_not_on_whatsapp")
    except HTTPException: raise
    except Exception as e:                                       # noqa: BLE001
        # Si la validacion falla por error de red, NO bloqueamos el
        # envio — el send normal seguira y si tampoco va devolvera
        # 502 como siempre.
        log.warning("[no_wa] check fallo (continuando con envio): %s", e)

    try:
        message_id = wa.send_text(instance, normalized, text, kind=kind, lead_id=lead_id)
    except WhatsAppError as e:
        log.warning("internal/send-text failed (queued for retry): %s", e)
        # Auto-detect ban: si el error es 5XX de Evolution o el state
        # paso a 'close' aqui mismo, activamos pausa de 6h. Los
        # siguientes calls a este endpoint cortan en 503 sin tocar
        # Evolution, dando a la sesion tiempo de re-pairing limpio.
        _maybe_auto_pause_on_evolution_error(str(e))
        # The send_text helper already enqueued for retry on its way
        # out. We still return 502 so the caller logs the FIRST attempt
        # as a known failure — but the queue will redeliver in 30 s,
        # then 1 m, etc. without further admin action. The "queued"
        # signal lets the web side mute its alarm.
        raise HTTPException(status_code=502, detail=f"whatsapp_error:{e}", headers={"X-Queued-For-Retry": "1"})

    return {"ok": True, "messageId": message_id}


# ─────────────────────────────────────────────────────────────────
# Cache local de "este numero tiene WhatsApp" (24h positivo, 1h
# negativo). Evita golpear el endpoint /chat/whatsappNumbers en
# cada send (rate-limited tambien por WhatsApp). Reseteado en cada
# restart del proceso — suficiente para nuestra escala.
# ─────────────────────────────────────────────────────────────────
_WA_EXISTS_CACHE: dict[str, tuple[bool, float]] = {}

def _exists_on_whatsapp_cached(wa, instance: str, phone: str) -> bool:
    import time
    now = time.time()
    cached = _WA_EXISTS_CACHE.get(phone)
    if cached:
        exists, ts = cached
        ttl = 24 * 3600 if exists else 3600
        if now - ts < ttl:
            return exists
    try:
        exists = bool(wa.is_number_on_whatsapp(instance, phone))
    except Exception:                                            # noqa: BLE001
        # Si la API falla, asumimos True (no bloqueamos por error de
        # validacion — el send normal cogera el error real si toca).
        return True
    _WA_EXISTS_CACHE[phone] = (exists, now)
    return exists


def _maybe_auto_pause_on_evolution_error(err_str: str) -> None:
    """Detecta señales de ban / sesion caida y activa pausa global de 6h.

    Heuristicas:
      - http 5xx repetidos (>= 3 en 5 min)
      - "exists":false con frecuencia (numero no-WA)
      - texto "rate" / "spam" / "blocked"
    """
    import re, datetime
    triggers = (
        "rate" in err_str.lower()
        or "spam" in err_str.lower()
        or "blocked" in err_str.lower()
        or "logged out" in err_str.lower()
        or re.search(r"\[5\d{2}\]", err_str) is not None
    )
    if not triggers:
        return
    try:
        from agents.shared.db import get_conn
        until = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=6)).isoformat()
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO config (key, value, updated_at) VALUES ('system_paused_until', %s, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """, (until,))
        log.error("[auto-pause] Senial de ban detectada — pausando envios hasta %s", until)
    except Exception as e:                                       # noqa: BLE001
        log.error("[auto-pause] No pude setear system_paused_until: %s", e)


@app.post("/internal/send-document")
async def internal_send_document(request: Request):
    """
    Envía un documento (PDF) por WhatsApp.

    POST body: {
      "phone":     "+4915...",
      "media_url": "https://...firmada.../guia.pdf",
      "file_name": "guia-A0.pdf",
      "caption":   "Aquí tu guía gratis 🎁",     // opcional
      "kind":      "diagnostico_pdf",            // opcional
      "lead_id":   "uuid"                         // opcional
    }
    Auth: X-Internal-Secret.
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

    phone     = (body.get("phone") or "").strip()
    media_url = (body.get("media_url") or "").strip()
    file_name = (body.get("file_name") or "guia.pdf").strip()
    caption   = (body.get("caption") or "").strip()
    kind      = (body.get("kind") or "manual")[:60]
    lead_id   = body.get("lead_id") or None

    if not phone or not media_url:
        raise HTTPException(status_code=400, detail="missing_phone_or_media_url")
    try:
        normalized = normalize_phone(phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid_phone:{e}")

    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    wa = WhatsAppService()

    try:
        message_id = wa.send_document(
            instance, normalized, media_url, file_name,
            caption=caption, kind=kind, lead_id=lead_id,
        )
    except WhatsAppError as e:
        log.warning("internal/send-document failed: %s", e)
        raise HTTPException(status_code=502, detail=f"whatsapp_error:{e}")

    return {"ok": True, "messageId": message_id}


# ──────────────────────────────────────────────────────────
# ──────────────────────────────────────────────────────────
# /internal/check-numbers — batch validate phones on WhatsApp
# ──────────────────────────────────────────────────────────
# Pre-validación de números antes de enviar campañas masivas (Gelfis
# 2026-06-23, tras ban summer_promo). Toma una lista de phones, llama
# /chat/whatsappNumbers (rate-limited de Evolution) y devuelve qué
# números SÍ están en WhatsApp y cuáles no. Usa el cache _WA_EXISTS_CACHE
# para evitar re-validar repetidamente.
#
# Body: { "phones": ["+34...", "+49..."] }
# Resp: { "ok": true, "results": { "+34...": true, "+49...": false } }

@app.post("/internal/check-numbers")
async def internal_check_numbers(request: Request):
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
    phones = body.get("phones") or []
    if not isinstance(phones, list) or len(phones) == 0:
        raise HTTPException(status_code=400, detail="missing_phones")
    if len(phones) > 200:
        raise HTTPException(status_code=400, detail="too_many_phones_max_200")

    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    wa = WhatsAppService()

    results: dict[str, bool] = {}
    for p in phones:
        if not isinstance(p, str): continue
        try:
            normalized = normalize_phone(p)
        except ValueError:
            results[p] = False
            continue
        try:
            exists = _exists_on_whatsapp_cached(wa, instance, normalized)
            results[p] = bool(exists)
        except Exception as e:                                # noqa: BLE001
            log.warning("check-numbers failed for %s: %s", normalized, e)
            # Si la validación falla, decimos None (no contamos como falso)
            results[p] = True  # asumimos OK en error de API — el send real lo cogerá

    return {"ok": True, "checked": len(results), "results": results}


# /internal/whatsapp-status — used by /admin/system dashboard
# ──────────────────────────────────────────────────────────


@app.get("/internal/whatsapp-status")
async def internal_whatsapp_status(request: Request):
    expected = os.environ.get("AGENTS_INTERNAL_SECRET")
    if not expected:
        raise HTTPException(status_code=503, detail="internal_secret_not_configured")
    provided = request.headers.get("x-internal-secret")
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="unauthorized")

    instance = os.environ.get("EVOLUTION_INSTANCE_MAIN", "aprender-aleman-main")
    wa = WhatsAppService()
    state = "unknown"
    err   = None
    try:
        state = wa.get_connection_state(instance)
    except Exception as e:                              # noqa: BLE001
        err = str(e)[:200]

    # Queue snapshot.
    queue: dict = {}
    try:
        from agents.shared.outbound_queue import stats as queue_stats
        queue = queue_stats()
    except Exception as e:                              # noqa: BLE001
        queue = {"error": str(e)[:120]}

    return {"ok": True, "state": state, "queue": queue, "instance": instance, "error": err}


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
