"""
Pre-send guard — última línea de defensa antes de llamar a Evolution API.

Decisión Gelfis 2026-05-04 tras incidente Asmaa (3 mensajes idénticos
enviados en 13s porque el agente respondía a cada inbound consecutivo
con la misma plantilla).

Reglas (cualquier veto bloquea):

  1. **Dedup por contenido** — si el MISMO texto (o ≥90% similar) fue
     enviado a este mismo lead en los últimos 5 minutos → bloquea.
     Esto cubre el caso de respuestas templadas idénticas a inbounds
     consecutivos.

  2. **Dedup por hash exacto** — si el HASH del texto exacto fue
     enviado al lead en los últimos 30 minutos → bloquea. Más laxo
     que la regla 1 (similaridad ≥90% pillaría también variantes).

  3. **Burst guard** — si el lead recibió ≥3 mensajes outbound en los
     últimos 60 segundos → bloquea. Cualquier mensaje #4+ huele a bug.

Cuando bloquea, registra en `lead_timeline` con type='send_failed'
y metadata.reason = el código de regla, para que el dashboard
/admin/system lo recoja y se vea en métricas.

Uso desde agent_3_sender.py:

    from agents.shared.pre_send_guard import check_can_send
    verdict = check_can_send(lead_id, text)
    if verdict.blocked:
        log_timeline(lead_id, type="send_failed", content=...)
        return SendResult(success=False, reason=verdict.code)
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

from agents.shared.db import get_conn

log = logging.getLogger("pre_send_guard")


@dataclass
class GuardVerdict:
    blocked: bool
    code:    str = ""             # "dup_content" | "dup_hash" | "burst" | ""
    detail:  str = ""             # human-readable line for timeline


def _hash(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()[:16]


def _similar(a: str, b: str) -> float:
    """Token-level similarity 0..1. SequenceMatcher is fine for ≤500 chars."""
    return SequenceMatcher(None, a.strip(), b.strip()).ratio()


def check_can_send(lead_id: str, text: str) -> GuardVerdict:
    """
    Run all 3 guards. Returns blocked=True at the first violation.
    Caller MUST honour the verdict — never bypass.
    """
    text_clean = (text or "").strip()
    if not text_clean:
        return GuardVerdict(blocked=True, code="empty_text", detail="texto vacío")

    now = datetime.now(timezone.utc)

    with get_conn() as conn, conn.cursor() as cur:
        # Pull last 10 outbound messages to this lead in the last hour.
        # 10 is plenty for the 3 checks below; bigger windows just slow
        # the guard down with no benefit.
        cur.execute(
            """
            SELECT message_body, sent_at
              FROM message_send_log
             WHERE lead_id = %s
               AND success = TRUE
               AND sent_at > %s
             ORDER BY sent_at DESC
             LIMIT 10
            """,
            (lead_id, now - timedelta(hours=1)),
        )
        rows = cur.fetchall()

    # 3) Burst guard — ≥3 outbounds en los últimos 60s.
    burst_threshold = now - timedelta(seconds=60)
    burst_count = sum(1 for (_, sent_at) in rows if sent_at >= burst_threshold)
    if burst_count >= 3:
        return GuardVerdict(
            blocked=True,
            code="burst",
            detail=f"3+ outbounds en últimos 60s (este sería el #{burst_count + 1})",
        )

    # 2) Hash exacto últimos 30 min.
    h_new = _hash(text_clean)
    hash_window = now - timedelta(minutes=30)
    for (body, sent_at) in rows:
        if sent_at < hash_window:
            break
        if _hash(body or "") == h_new:
            mins = int((now - sent_at).total_seconds() / 60)
            return GuardVerdict(
                blocked=True,
                code="dup_hash",
                detail=f"texto idéntico enviado hace {mins} min",
            )

    # 1) Similaridad ≥90% últimos 5 min.
    sim_window = now - timedelta(minutes=5)
    for (body, sent_at) in rows:
        if sent_at < sim_window:
            break
        sim = _similar(text_clean, body or "")
        if sim >= 0.90:
            secs = int((now - sent_at).total_seconds())
            return GuardVerdict(
                blocked=True,
                code="dup_content",
                detail=f"contenido {int(sim*100)}% similar al enviado hace {secs}s",
            )

    return GuardVerdict(blocked=False)
