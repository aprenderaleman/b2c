"""
Test suite end-to-end del plan de reliability (2026-04-30).

Diseñada para correr DENTRO de aa_agents_scheduler:

    docker exec aa_agents_scheduler python -m agents.scripts.test_reliability

Cada test:
  • Hace setup con datos sintéticos (prefijo TEST_) o lead "lost" para
    no afectar producción.
  • Mockea _send_ helpers cuando hace falta para no spamear Gelfis.
  • Verifica el comportamiento esperado.
  • Limpia (teardown) ANTES de salir.

Salida: resumen PASS/FAIL al final, exit 0 si todo verde.
"""
from __future__ import annotations

import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from agents.shared.db import get_conn


# ─────────────────────────────────────────────────────────
# Test framework simple
# ─────────────────────────────────────────────────────────
RESULTS: list[tuple[str, bool, str]] = []


def _clear_sara_recent_events() -> None:
    """Borra cualquier residuo en lead_timeline de Sara más reciente que
    30 min (status_change/escalation/lead_message_received/system_message_sent
    de tests previos o mensajes huérfanos). Mantiene historia >30min
    intacta para no perder auditoría real."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """DELETE FROM lead_timeline
                WHERE lead_id = (SELECT id FROM leads WHERE name='Sara')
                  AND timestamp > NOW() - INTERVAL '30 minutes'""",
        )


def test(name: str):
    def deco(fn):
        try:
            fn()
            print(f"  ✓ PASS  {name}")
            RESULTS.append((name, True, ""))
        except AssertionError as e:
            print(f"  ✗ FAIL  {name}: {e}")
            RESULTS.append((name, False, str(e)))
        except Exception as e:                          # noqa: BLE001
            print(f"  ✗ ERROR {name}: {e}")
            traceback.print_exc()
            RESULTS.append((name, False, f"{type(e).__name__}: {e}"))
        return fn
    return deco


def header(s: str):
    print(f"\n══════════ {s} ══════════")


# ─────────────────────────────────────────────────────────
# Test 1 — bug fix: dict messageTimestamp
# ─────────────────────────────────────────────────────────
header("1. Bug fix: dict messageTimestamp")

@test("dict messageTimestamp se parsea correctamente")
def _():
    # Replicamos el parseo inline para verificar
    import datetime as dt

    def parse_mts(mts_raw):
        if isinstance(mts_raw, dict):
            low  = mts_raw.get("low")  or 0
            high = mts_raw.get("high") or 0
            mts_int = (high << 32) | (low & 0xFFFFFFFF)
        else:
            mts_int = int(mts_raw)
        if mts_int > 1_000_000_000_000:
            mts_int = mts_int // 1000
        return dt.datetime.fromtimestamp(mts_int, tz=dt.timezone.utc)

    # int en segundos
    assert parse_mts(1_700_000_000).year == 2023
    # int en milisegundos
    assert parse_mts(1_700_000_000_000).year == 2023
    # dict (long.js BigInt format)
    d = parse_mts({"low": 1_700_000_000, "high": 0})
    assert d.year == 2023, f"got year={d.year}"


# ─────────────────────────────────────────────────────────
# Test 1.b — Localización de fechas (no mezclar idiomas)
# ─────────────────────────────────────────────────────────
header("1.b Localización de fechas (no inglés en mensajes alemanes)")

@test("_format_trial_when(dt, 'de') usa nombres alemanes (Donnerstag, no Thursday)")
def _():
    from agents.agent_4_conversation import _format_trial_when
    from datetime import datetime, timezone

    # Jueves 30 de abril 2026, 13:00 Berlin
    dt = datetime(2026, 4, 30, 11, 0, 0, tzinfo=timezone.utc)  # 13:00 Berlin
    s = _format_trial_when(dt, "de")
    # Debe contener nombre alemán
    assert "Donnerstag" in s, f"falta Donnerstag en alemán: {s!r}"
    # NO debe contener nombres en inglés
    for en_day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"):
        assert en_day not in s, f"contiene día en inglés: {en_day} en {s!r}"
    # NO debe contener nombres en español
    for es_day in ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"):
        assert es_day not in s, f"contiene día en español: {es_day} en mensaje alemán {s!r}"
    # Debe contener "April" (alemán) no "abril" ni "April" en inglés (April es igual en alemán e inglés, así que OK)
    assert "April" in s, f"falta mes April: {s!r}"


@test("_format_trial_when(dt, 'es') usa nombres españoles (jueves, no Thursday)")
def _():
    from agents.agent_4_conversation import _format_trial_when
    from datetime import datetime, timezone

    dt = datetime(2026, 4, 30, 11, 0, 0, tzinfo=timezone.utc)
    s = _format_trial_when(dt, "es")
    assert "jueves" in s, f"falta jueves: {s!r}"
    assert "abril" in s, f"falta abril: {s!r}"
    for en_day in ("Thursday", "April"):
        assert en_day not in s, f"contiene palabra inglesa: {en_day} en {s!r}"


# ─────────────────────────────────────────────────────────
# Test 1.c — _handle_trial_already_booked NO menciona profesor
# y NO incluye "¿en qué te puedo ayudar?" para confirmaciones cortas
# ─────────────────────────────────────────────────────────
header("1.c trial_already_booked: sin profesor, sin pregunta innecesaria")

@test("Confirmación corta ('Ja') → mensaje breve sin profesor ni pregunta")
def _():
    _clear_sara_recent_events()
    from agents.agent_4_conversation import _handle_trial_already_booked, _trial_class_details
    from unittest.mock import MagicMock, patch

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM leads WHERE name='Sara' LIMIT 1")
        sara = dict(cur.fetchone())

    # Mock: el lead "Christian" tiene un trial agendado y el lead env ía "Ja"
    sara["language"] = "de"
    sara["name"] = "Christian"

    sent_body = {}
    def fake_send(lead, body, **kw):
        sent_body["body"] = body
        return MagicMock(success=True)

    with patch("agents.agent_4_conversation._trial_class_details",
               return_value=(__import__("datetime").datetime(2026, 4, 30, 11, 0, 0,
                             tzinfo=__import__("datetime").timezone.utc), "Gelfis Horn")), \
         patch("agents.agent_4_conversation.send_approved", side_effect=fake_send):
        _handle_trial_already_booked(sara, "Ja", None)

    body = sent_body.get("body", "")
    # NO mencionar profesor
    assert "Gelfis" not in body, f"contiene 'Gelfis' (nombre del profesor): {body!r}"
    assert "mit Gelfis" not in body, f"contiene 'mit Gelfis': {body!r}"
    # NO incluir "Wie kann ich dir helfen"
    assert "helfen" not in body, f"contiene 'helfen' (pregunta innecesaria): {body!r}"
    # Día de la semana en alemán correcto
    assert "Donnerstag" in body, f"falta Donnerstag (alemán): {body!r}"
    for en_day in ("Thursday", "Friday", "Monday"):
        assert en_day not in body, f"contiene día en inglés: {body!r}"


@test("Confirmación corta ES ('Sí') → mensaje breve sin profesor ni pregunta")
def _():
    _clear_sara_recent_events()
    from agents.agent_4_conversation import _handle_trial_already_booked
    from unittest.mock import MagicMock, patch

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM leads WHERE name='Sara' LIMIT 1")
        sara = dict(cur.fetchone())
    sara["language"] = "es"

    sent_body = {}
    def fake_send(lead, body, **kw):
        sent_body["body"] = body
        return MagicMock(success=True)

    with patch("agents.agent_4_conversation._trial_class_details",
               return_value=(__import__("datetime").datetime(2026, 4, 30, 11, 0, 0,
                             tzinfo=__import__("datetime").timezone.utc), "Sabine Arning")), \
         patch("agents.agent_4_conversation.send_approved", side_effect=fake_send):
        _handle_trial_already_booked(sara, "Sí", None)

    body = sent_body.get("body", "")
    assert "Sabine" not in body, f"contiene 'Sabine': {body!r}"
    assert "puedo ayudar" not in body, f"contiene '¿en qué te puedo ayudar?': {body!r}"
    assert "jueves" in body, f"falta 'jueves' en español: {body!r}"


# ─────────────────────────────────────────────────────────
# Test 2 — Watchdog silent_inbound
# ─────────────────────────────────────────────────────────
header("2. Watchdog inbound silencioso")

@test("Detecta lead que escribió hace >15min sin respuesta del bot")
def _():
    from agents.notifications import scan_silent_inbounds_and_alert

    _clear_sara_recent_events()
    # Usamos Sara (ya lost+paused) como conejillo de indias
    _clear_sara_recent_events()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, status, ai_paused_until FROM leads WHERE name='Sara' LIMIT 1")
        sara = cur.fetchone()
        assert sara, "Sara no existe"
        backup = (sara["status"], sara["ai_paused_until"])
        try:
            # Estado: in_conversation, sin pausa, con mensaje viejo del lead
            cur.execute(
                "UPDATE leads SET status='in_conversation', ai_paused_until=NULL WHERE id=%s",
                (sara["id"],),
            )
            cur.execute(
                """INSERT INTO lead_timeline (lead_id, type, author, content, timestamp)
                   VALUES (%s, 'lead_message_received', 'lead', 'TEST silent', NOW() - INTERVAL '20 minutes')
                   RETURNING id""",
                (sara["id"],),
            )
            test_evt_id = cur.fetchone()["id"]

            # Mockeamos _send para no alertar realmente
            with patch("agents.notifications._send", return_value=True) as mock_send:
                count = scan_silent_inbounds_and_alert()
                assert count >= 1, f"Esperaba >=1 alerta, obtuve {count}"
                # Verificar que Sara estuvo entre los lead_id alertados
                called_lead_ids = [
                    kwargs.get("lead_id") for _, _, kwargs in mock_send.mock_calls
                ]
                assert str(sara["id"]) in [str(x) for x in called_lead_ids], \
                    f"Sara no fue alertada: {called_lead_ids}"
        finally:
            cur.execute("DELETE FROM lead_timeline WHERE id=%s", (test_evt_id,))
            cur.execute(
                "UPDATE leads SET status=%s, ai_paused_until=%s WHERE id=%s",
                (backup[0], backup[1], sara["id"]),
            )


@test("NO alerta si lead respondió hace solo 5min (dentro ventana 15min)")
def _():
    from agents.notifications import scan_silent_inbounds_and_alert

    _clear_sara_recent_events()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, status, ai_paused_until FROM leads WHERE name='Sara' LIMIT 1")
        sara = cur.fetchone()
        backup = (sara["status"], sara["ai_paused_until"])
        try:
            cur.execute(
                "UPDATE leads SET status='in_conversation', ai_paused_until=NULL WHERE id=%s",
                (sara["id"],),
            )
            cur.execute(
                """INSERT INTO lead_timeline (lead_id, type, author, content, timestamp)
                   VALUES (%s, 'lead_message_received', 'lead', 'TEST recent', NOW() - INTERVAL '5 minutes')
                   RETURNING id""",
                (sara["id"],),
            )
            test_evt_id = cur.fetchone()["id"]

            with patch("agents.notifications._send", return_value=True) as mock_send:
                scan_silent_inbounds_and_alert()
                called = [kwargs.get("lead_id") for _, _, kwargs in mock_send.mock_calls]
                assert str(sara["id"]) not in [str(x) for x in called], \
                    "Sara fue alertada incorrectamente (mensaje muy reciente)"
        finally:
            cur.execute("DELETE FROM lead_timeline WHERE id=%s", (test_evt_id,))
            cur.execute(
                "UPDATE leads SET status=%s, ai_paused_until=%s WHERE id=%s",
                (backup[0], backup[1], sara["id"]),
            )


@test("NO alerta si lead está paused/cold/lost")
def _():
    from agents.notifications import scan_silent_inbounds_and_alert

    _clear_sara_recent_events()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, status, ai_paused_until FROM leads WHERE name='Sara' LIMIT 1")
        sara = cur.fetchone()
        # Sara YA está en lost+paused, así que dejarla así y meter evento viejo
        try:
            cur.execute(
                """INSERT INTO lead_timeline (lead_id, type, author, content, timestamp)
                   VALUES (%s, 'lead_message_received', 'lead', 'TEST lost', NOW() - INTERVAL '30 minutes')
                   RETURNING id""",
                (sara["id"],),
            )
            test_evt_id = cur.fetchone()["id"]

            with patch("agents.notifications._send", return_value=True) as mock_send:
                scan_silent_inbounds_and_alert()
                called = [kwargs.get("lead_id") for _, _, kwargs in mock_send.mock_calls]
                assert str(sara["id"]) not in [str(x) for x in called], \
                    "Sara (lost+paused) fue alertada — no debería"
        finally:
            cur.execute("DELETE FROM lead_timeline WHERE id=%s", (test_evt_id,))


# ─────────────────────────────────────────────────────────
# Test 3 — Watchdog unmatched_lids
# ─────────────────────────────────────────────────────────
header("3. Watchdog LIDs no asociados")

@test("Detecta unmatched_inbound viejo y alerta")
def _():
    from agents.notifications import scan_unmatched_lids_and_alert

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO unmatched_inbounds
                  (jid, push_name, content_preview, candidates, received_at)
               VALUES ('TESTLID@lid', 'TestUser', 'hola', 'Sara(+34657...)',
                       NOW() - INTERVAL '10 minutes')
               RETURNING id""",
        )
        test_id = cur.fetchone()["id"]
        try:
            with patch("agents.notifications._send", return_value=True) as mock_send:
                count = scan_unmatched_lids_and_alert()
                assert count >= 1, f"Esperaba >=1 alerta, obtuve {count}"
        finally:
            cur.execute("DELETE FROM unmatched_inbounds WHERE id=%s", (test_id,))


@test("NO alerta si unmatched es muy reciente (<5min, posiblemente aún resoluble)")
def _():
    from agents.notifications import scan_unmatched_lids_and_alert

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO unmatched_inbounds
                  (jid, push_name, content_preview, received_at)
               VALUES ('TESTLID2@lid', 'TestUser2', 'hola', NOW() - INTERVAL '2 minutes')
               RETURNING id""",
        )
        test_id = cur.fetchone()["id"]
        try:
            with patch("agents.notifications._send", return_value=True) as mock_send:
                scan_unmatched_lids_and_alert()
                # Verificar que NO se llamó con jid TESTLID2
                bodies = [args[1] for args, _, _ in mock_send.mock_calls if len(args) >= 2]
                assert not any("TESTLID2" in b for b in bodies), \
                    "alertó sobre unmatched muy reciente"
        finally:
            cur.execute("DELETE FROM unmatched_inbounds WHERE id=%s", (test_id,))


# ─────────────────────────────────────────────────────────
# Test 4 — Watchdog Evolution health
# ─────────────────────────────────────────────────────────
header("4. Watchdog Evolution health")

@test("NO alerta cuando state='open'")
def _():
    from agents.notifications import scan_evolution_health_and_alert

    with patch("agents.whatsapp_service.WhatsAppService.get_connection_state",
               return_value="open"), \
         patch("agents.notifications._send", return_value=True) as mock_send:
        result = scan_evolution_health_and_alert()
        assert result == 0, f"alertó con state=open: {result}"


@test("ALERTA cuando state='close'")
def _():
    from agents.notifications import scan_evolution_health_and_alert

    with patch("agents.whatsapp_service.WhatsAppService.get_connection_state",
               return_value="close"), \
         patch("agents.notifications._send", return_value=True) as mock_send:
        result = scan_evolution_health_and_alert()
        assert result == 1, f"no alertó con state=close: {result}"


# ─────────────────────────────────────────────────────────
# Test 5 — Inbound processing queue
# ─────────────────────────────────────────────────────────
header("5. Inbound processing queue")

@test("Encola un inbound y lo marca done")
def _():
    from agents.webhook_server import _enqueue_for_processing, _mark_queue_done

    _clear_sara_recent_events()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM leads WHERE name='Sara' LIMIT 1")
        sara_id = cur.fetchone()["id"]
        unique_text = f"TEST queue inbound {uuid4().hex[:8]}"

        _enqueue_for_processing(sara_id, unique_text, f"TEST_{uuid4().hex[:8]}")

        # Verificar que está pending
        cur.execute(
            "SELECT status FROM inbound_processing_queue WHERE lead_id=%s AND text=%s",
            (sara_id, unique_text),
        )
        row = cur.fetchone()
        assert row, "no se insertó la fila"
        assert row["status"] == "pending", f"status={row['status']}"

        _mark_queue_done(sara_id, unique_text)

        cur.execute(
            "SELECT status FROM inbound_processing_queue WHERE lead_id=%s AND text=%s",
            (sara_id, unique_text),
        )
        row = cur.fetchone()
        assert row["status"] == "done", f"status post mark_done={row['status']}"

        # Cleanup
        cur.execute(
            "DELETE FROM inbound_processing_queue WHERE lead_id=%s AND text=%s",
            (sara_id, unique_text),
        )


@test("Drain procesa pending y reintenta si Agent 4 falla")
def _():
    from agents.scheduler import _drain_inbound_queue

    _clear_sara_recent_events()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM leads WHERE name='Sara' LIMIT 1")
        sara_id = cur.fetchone()["id"]
        unique_text = f"TEST drain {uuid4().hex[:8]}"
        cur.execute(
            """INSERT INTO inbound_processing_queue (lead_id, text, status, next_attempt_at)
               VALUES (%s, %s, 'pending', NOW())""",
            (sara_id, unique_text),
        )
        try:
            # Mock handle_incoming_message para que SIEMPRE falle
            with patch("agents.agent_4_conversation.handle_incoming_message",
                       side_effect=RuntimeError("forced test failure")):
                _drain_inbound_queue()

            cur.execute(
                "SELECT status, retry_count, last_error FROM inbound_processing_queue WHERE lead_id=%s AND text=%s",
                (sara_id, unique_text),
            )
            row = cur.fetchone()
            assert row, "fila desapareció"
            assert row["status"] == "pending", f"esperaba pending tras 1 fallo, got {row['status']}"
            assert row["retry_count"] == 1, f"retry_count={row['retry_count']}"
            assert "forced test failure" in (row["last_error"] or ""), \
                f"last_error no captura: {row['last_error']}"
        finally:
            cur.execute(
                "DELETE FROM inbound_processing_queue WHERE lead_id=%s AND text=%s",
                (sara_id, unique_text),
            )


# ─────────────────────────────────────────────────────────
# Test 6 — trial_attended bloquea bot
# ─────────────────────────────────────────────────────────
header("6. trial_attended escalation")

@test("Lead post-trial-attended → bot NO responde + escala")
def _():
    from agents.agent_4_conversation import handle_incoming_message

    _clear_sara_recent_events()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM leads WHERE name='Sara' LIMIT 1")
        sara = dict(cur.fetchone())
        backup = (sara["status"], sara["ai_paused_until"])
        try:
            cur.execute(
                "UPDATE leads SET status='in_conversation', ai_paused_until=NULL WHERE id=%s",
                (sara["id"],),
            )
            sara["status"] = "in_conversation"
            sara["ai_paused_until"] = None

            # Insertar status_change "Lead attended trial — awaiting…"
            # como hace markTrialAttendedAwaitingConversion en admin-actions.ts
            cur.execute(
                """INSERT INTO lead_timeline (lead_id, type, author, content, timestamp)
                   VALUES (%s, 'status_change', 'gelfis',
                           'Lead attended trial — awaiting conversion decision.',
                           NOW() - INTERVAL '1 day')
                   RETURNING id""",
                (sara["id"],),
            )
            test_evt_id = cur.fetchone()["id"]

            # Si compose_reply o send_approved se llaman, el test falla
            with patch("agents.agent_4_conversation.compose_reply") as mock_compose, \
                 patch("agents.agent_4_conversation.send_approved") as mock_send, \
                 patch("agents.notifications._send", return_value=True):
                result = handle_incoming_message(sara, "test inbound post-trial")
                assert result.intent == "trial_attended_escalated", \
                    f"intent={result.intent}"
                assert result.sent is False, "bot envió respuesta — no debería"
                mock_compose.assert_not_called()
                mock_send.assert_not_called()

            # Verificar que se loggeó escalación con alert_gelfis=true
            cur.execute(
                """SELECT metadata FROM lead_timeline
                    WHERE lead_id=%s AND type='escalation' AND content ILIKE %s
                    ORDER BY timestamp DESC LIMIT 1""",
                (sara["id"], "%test inbound post-trial%"),
            )
            row = cur.fetchone()
            assert row, "no se creó evento escalation"
            assert (row["metadata"] or {}).get("alert_gelfis") is True, \
                f"alert_gelfis no setteado: {row['metadata']}"
        finally:
            # Limpiar
            cur.execute("DELETE FROM lead_timeline WHERE id=%s", (test_evt_id,))
            cur.execute(
                "DELETE FROM lead_timeline WHERE lead_id=%s AND type='escalation' AND content ILIKE %s",
                (sara["id"], "%test inbound post-trial%"),
            )
            # Borrar el lead_message_received que handle_incoming_message creó
            cur.execute(
                "DELETE FROM lead_timeline WHERE lead_id=%s AND type='lead_message_received' AND content = %s",
                (sara["id"], "test inbound post-trial"),
            )
            cur.execute(
                "UPDATE leads SET status=%s, ai_paused_until=%s WHERE id=%s",
                (backup[0], backup[1], sara["id"]),
            )


# ─────────────────────────────────────────────────────────
# Test 7 — Synthetic monitor end-to-end
# ─────────────────────────────────────────────────────────
header("7. Synthetic monitor")

@test("run_synthetic_check completa el chain webhook→dedup")
def _():
    from agents.synthetic_monitor import run_synthetic_check
    result = run_synthetic_check()
    assert result.get("ok") is True, f"synthetic falló: {result}"


# ─────────────────────────────────────────────────────────
# Test 8 — Daily summary contiene secciones nuevas
# ─────────────────────────────────────────────────────────
header("8. Daily summary ampliado")

@test("notify_daily_summary genera body con secciones de reliability")
def _():
    from agents.notifications import notify_daily_summary

    captured = {}
    def fake_send(kind, body, **kw):
        captured["body"] = body
        return True

    with patch("agents.notifications._send", side_effect=fake_send):
        notify_daily_summary()

    body = captured.get("body", "")
    assert "Mensajería" in body, f"falta sección Mensajería: {body[:200]}"
    assert "Watchdogs" in body, f"falta sección Watchdogs: {body[:200]}"
    assert "Inbounds silenciosos" in body, f"falta métrica silent: {body[:200]}"
    assert "Cola inbound" in body, f"falta métrica cola: {body[:200]}"


# ─────────────────────────────────────────────────────────
# Test 9 — Verificar que count_silent_inbounds RPC funciona
# ─────────────────────────────────────────────────────────
header("9. RPC count_silent_inbounds")

@test("count_silent_inbounds() devuelve número")
def _():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT count_silent_inbounds() AS n")
        row = cur.fetchone()
        assert isinstance(row["n"], int), f"tipo no entero: {row}"
        assert row["n"] >= 0


# ─────────────────────────────────────────────────────────
# Test 10 — Webhook async + dedup
# ─────────────────────────────────────────────────────────
header("10. Webhook async + dedup")

@test("webhook responde 200 en <2s (async)")
def _():
    import httpx, json, time as _t
    msg_id = f"TEST_LATENCY_{uuid4().hex[:12]}"
    payload = {
        "event": "messages.upsert",
        "data": {
            "key": {"id": msg_id, "remoteJid": "9999999999@s.whatsapp.net", "fromMe": False},
            "pushName": "LatencyTest",
            "message": {"conversation": "test latency"},
            "sender": "9999999999",
        },
    }
    t0 = _t.time()
    with httpx.Client(timeout=10.0) as cli:
        r = cli.post("http://aa_agents_webhook:8000/webhook/whatsapp", json=payload)
    elapsed = _t.time() - t0
    assert r.status_code == 200, f"http {r.status_code}"
    assert elapsed < 2.0, f"latencia {elapsed:.2f}s — handler no es async"

    # Cleanup
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM inbound_dedup WHERE wa_message_id = %s", (msg_id,))


@test("Segundo POST con mismo key.id devuelve duplicate=true")
def _():
    import httpx
    msg_id = f"TEST_DEDUP_{uuid4().hex[:12]}"
    payload = {
        "event": "messages.upsert",
        "data": {
            "key": {"id": msg_id, "remoteJid": "9999999999@s.whatsapp.net", "fromMe": False},
            "pushName": "DedupTest",
            "message": {"conversation": "test dedup"},
            "sender": "9999999999",
        },
    }
    with httpx.Client(timeout=10.0) as cli:
        r1 = cli.post("http://aa_agents_webhook:8000/webhook/whatsapp", json=payload)
        r2 = cli.post("http://aa_agents_webhook:8000/webhook/whatsapp", json=payload)
        r3 = cli.post("http://aa_agents_webhook:8000/webhook/whatsapp", json=payload)

    assert r1.status_code == 200 and r2.status_code == 200 and r3.status_code == 200
    j1, j2, j3 = r1.json(), r2.json(), r3.json()
    assert j1.get("duplicate") is not True, f"1ra POST no debería ser dup: {j1}"
    assert j2.get("duplicate") is True, f"2da POST debería ser dup: {j2}"
    assert j3.get("duplicate") is True, f"3ra POST debería ser dup: {j3}"

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM inbound_dedup WHERE wa_message_id = %s", (msg_id,))


# ─────────────────────────────────────────────────────────
# Resumen
# ─────────────────────────────────────────────────────────
print("\n\n══════════════════════════════════════════════════════")
print("                    RESUMEN")
print("══════════════════════════════════════════════════════")
passed = sum(1 for _, ok, _ in RESULTS if ok)
total  = len(RESULTS)
for name, ok, err in RESULTS:
    icon = "✓" if ok else "✗"
    print(f"  {icon} {name}")
    if not ok and err:
        print(f"       └─ {err[:200]}")

print(f"\n  {passed}/{total} pruebas pasaron")
sys.exit(0 if passed == total else 1)
