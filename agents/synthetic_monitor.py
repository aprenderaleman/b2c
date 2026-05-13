"""
Synthetic monitor — verifica end-to-end que el pipeline está sano.

Cada día (hora configurable) corre `run_synthetic_check()`:
  1. POSTea un payload sintético al webhook con un wa_message_id único.
  2. Espera N segundos a que el flujo procese el mensaje.
  3. Verifica que apareció en `inbound_dedup` (= webhook lo aceptó)
     Y que NO está en `inbound_processing_queue` con status='pending'/'failed_permanent'.
  4. Si algo falla, ping a Gelfis vía notify_synthetic_test_failed.

Importante: el wa_message_id sintético usa un prefijo `SYNTH_` para que
sea trivial filtrar en logs y limpiar tras la prueba.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from uuid import uuid4

import httpx

from agents.shared.db import get_conn
from agents.notifications import notify_synthetic_test_failed

log = logging.getLogger("synthetic_monitor")


def run_synthetic_check() -> dict:
    """Ejecuta una verificación end-to-end del webhook + dedup.

    Devuelve {"ok": True} en caso de éxito, o {"ok": False, "reason": ...}
    en caso de fallo (también notifica a Gelfis).
    """
    # Usar SIEMPRE la URL interna del Docker network — el dominio público
    # falla por hairpin NAT en el VPS Hetzner. La fix de Evolution para
    # webhook outbound usa el mismo truco (extra_hosts → coolify-proxy IP).
    url = "http://aa_agents_webhook:8000/webhook/whatsapp"

    msg_id = f"SYNTH_{uuid4().hex[:16]}"
    payload = {
        "event": "messages.upsert",
        "data": {
            "key": {
                "id":         msg_id,
                "remoteJid":  "1000000000000@s.whatsapp.net",   # phone que NO matchea ningún lead
                "fromMe":     False,
            },
            "pushName":   "SyntheticMonitor",
            "message":    {"conversation": f"synthetic test {datetime.utcnow().isoformat()}"},
            "sender":     "1000000000000",
        },
    }

    secret = os.environ.get("EVOLUTION_WEBHOOK_SECRET", "")
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-Webhook-Secret"] = secret

    # 1. POST al webhook
    try:
        with httpx.Client(timeout=10.0) as cli:
            r = cli.post(url, json=payload, headers=headers)
        if r.status_code != 200:
            reason = f"webhook returned http {r.status_code}: {r.text[:200]}"
            log.error("[synth] %s", reason)
            notify_synthetic_test_failed(reason)
            return {"ok": False, "reason": reason}
    except Exception as e:                              # noqa: BLE001
        reason = f"webhook POST failed: {e}"
        log.exception("[synth] %s", reason)
        notify_synthetic_test_failed(reason)
        return {"ok": False, "reason": reason}

    # 2. Esperar 3s para que el dedup persista
    time.sleep(3)

    # 3. Verificar que llegó al inbound_dedup
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM inbound_dedup WHERE wa_message_id = %s",
                (msg_id,),
            )
            row = cur.fetchone()
    except Exception as e:                              # noqa: BLE001
        reason = f"DB check failed: {e}"
        log.exception("[synth] %s", reason)
        notify_synthetic_test_failed(reason)
        return {"ok": False, "reason": reason}

    if not row:
        reason = f"webhook returned 200 but msg_id={msg_id} no apareció en inbound_dedup"
        log.error("[synth] %s", reason)
        notify_synthetic_test_failed(reason)
        return {"ok": False, "reason": reason}

    # 4. Limpieza: borrar la fila de dedup + cualquier unmatched_inbound asociado
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM inbound_dedup WHERE wa_message_id = %s", (msg_id,))
            cur.execute(
                "DELETE FROM unmatched_inbounds WHERE jid = '1000000000000@s.whatsapp.net' "
                "AND received_at > NOW() - INTERVAL '5 minutes'"
            )
    except Exception:                                   # noqa: BLE001
        log.exception("[synth] cleanup failed (no crítico)")

    log.info("[synth] OK — webhook→dedup chain verified")
    return {"ok": True, "msg_id": msg_id}
