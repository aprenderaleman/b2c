"""
Full-system smoke test — verifies every Python module imports clean,
all templates render grammatically, keyword detection handles the
tricky cases, and phone normalization produces E.164.

Runs WITHOUT hitting external services (no WhatsApp, no Claude, no DB).
Run:
    python -m agents.tests.test_smoke
"""
from __future__ import annotations

import os
import sys

# Placeholders so modules that read env on import don't explode.
os.environ.setdefault("EVOLUTION_API_KEY", "test")
os.environ.setdefault("DATABASE_URL", "postgresql://nobody@localhost/nobody")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-placeholder")


_failed = 0


def ok(label: str, cond: bool, note: str = "") -> None:
    global _failed
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {label}{' — ' + note if note else ''}")
    if not cond:
        _failed += 1


def section(title: str) -> None:
    print(f"\n── {title} ──")


def main() -> int:
    section("Module imports")
    try:
        from agents.shared.phone import normalize_phone, is_valid_e164
        from agents.shared.db import get_conn
        from agents.shared.rate_limits import in_send_window, can_send_now
        from agents.shared.leads import log_timeline, schedule_next_contact
        from agents.shared.claude_client import BRAND_CONTEXT, MODEL_HAIKU, MODEL_SONNET
        from agents.whatsapp_service import WhatsAppService, WhatsAppError
        from agents.agent_0_watcher import tick, PAUSED_STATUSES
        from agents.agent_1_writer import compose_message, compose_reply, MessageDraft
        from agents.agent_2_reviewer import review_single, review_batch, ReviewResult
        from agents.agent_3_sender import send_approved, SendResult
        from agents.agent_4_conversation import handle_incoming_message, BOOKING_WORDS, HUMAN_WORDS, NEGATIVE_WORDS, _has_phrase, _norm
        from agents.agent_5_guardian import (
            mark_attended_converted, mark_absent, tick_absent_followups,
        )
        from agents.notifications import (
            notify_needs_human, notify_trial_30min, notify_daily_summary,
            scan_escalations_and_notify,
        )
        from agents.webhook_server import app
        from agents.scheduler import main as scheduler_main
        ok("all agent modules import", True)
    except Exception as e:  # noqa: BLE001
        ok("all agent modules import", False, f"{type(e).__name__}: {e}")
        return 1

    section("Phone normalization")
    cases = [
        ("+49 152 5340 9644",  "+4915253409644"),
        ("015253409644",       "+4915253409644"),
        ("+34 612 345 678",    "+34612345678"),
        ("0034-612-345-678",   "+34612345678"),
        ("+52 55 1234 5678",   "+525512345678"),
        ("(+41) 79 123 45 67", "+41791234567"),
        ("15253409644",        "+4915253409644"),
    ]
    for raw, expected in cases:
        got = normalize_phone(raw)
        ok(f"normalize {raw!r}", got == expected and is_valid_e164(got), f"got {got!r}")

    section("Templates render all 6 goals × 2 languages")
    from agents.agent_1_writer import _template_contact_1, _template_contact_2, GOAL_CONTEXT_ES, GOAL_CONTEXT_DE
    for lang, table in (("es", GOAL_CONTEXT_ES), ("de", GOAL_CONTEXT_DE)):
        for goal in table.keys():
            lead = dict(
                id="x", name="Juan Pérez", whatsapp_normalized="+34612345678",
                language=lang, goal=goal, german_level="A1-A2",
                urgency="asap", status="new", current_followup_number=0,
                messages_seen_count=0,
            )
            t1 = _template_contact_1(lead)
            ok(f"[{lang}/{goal}] contact_1 non-empty + signs as Stiv",
               bool(t1) and "Stiv" in t1)
            lead["status"] = "contacted_1"
            t2 = _template_contact_2(lead)
            ok(f"[{lang}/{goal}] contact_2 mentions name",
               "Juan" in t2)

    section("Compose dispatcher respects status")
    for status, expected_kind in (
        ("new",             "template_contact_1"),
        ("contacted_1",     "template_contact_2"),
        ("converted",       None),
        ("needs_human",     None),
        ("lost",            None),
    ):
        lead = dict(
            id="x", name="Ana", language="es", goal="work",
            german_level="A0", urgency="asap", status=status,
            current_followup_number=0, messages_seen_count=0,
        )
        draft = compose_message(lead)
        if expected_kind is None:
            ok(f"status={status}: no draft", draft is None)
        else:
            ok(f"status={status}: kind={expected_kind}",
               draft is not None and draft.kind == expected_kind,
               f"got {draft.kind if draft else None}")

    section("Agent 2 pre-checks")
    lead = dict(id="x", name="Ana", language="es", goal="work",
                german_level="A0", urgency="asap", status="new",
                current_followup_number=0, messages_seen_count=0)
    auto = compose_message(lead)
    ok("auto-approve template", review_single(lead, auto).approved)
    empty_d = MessageDraft(text="", kind="ai_contact_3", language="es", uses_ai=True)
    ok("reject empty body", not review_single(lead, empty_d).approved)
    long_d = MessageDraft(text="x"*1500, kind="ai_contact_3", language="es", uses_ai=True)
    ok("reject too-long body", not review_single(lead, long_d).approved)

    section("Agent 4 keyword detection")
    kw_cases = [
        ("si, quiero agendar",           "es", "booking"),
        ("Sí, claro mándame el link",    "es", "booking"),
        ("Solo estoy viendo",            "es", None),
        ("ja, klar!",                    "de", "booking"),
        ("hablar con persona real",      "es", "human"),
        ("Ich möchte einen Berater",     "de", "human"),
        ("no me interesa, gracias",      "es", "negative"),
        ("bitte nicht mehr schreiben",   "de", "negative"),
        ("¿Cuánto cuesta el curso?",     "es", None),   # → AI
    ]
    for text, lang, expected in kw_cases:
        n = _norm(text)
        hits = {
            "booking":  _has_phrase(n, BOOKING_WORDS[lang]),
            "human":    _has_phrase(n, HUMAN_WORDS[lang] + HUMAN_WORDS["es" if lang=="de" else "de"]),
            "negative": _has_phrase(n, NEGATIVE_WORDS[lang] + NEGATIVE_WORDS["es" if lang=="de" else "de"]),
        }
        if expected is None:
            ok(f"[{lang}] {text!r} → AI fallback",
               all(v is None for v in hits.values()),
               f"got {hits}")
        else:
            ok(f"[{lang}] {text!r} → {expected}",
               hits[expected] is not None and all(v is None for k,v in hits.items() if k != expected),
               f"got {hits}")

    section("FastAPI app has required endpoints")
    paths = {r.path for r in app.routes if hasattr(r, "methods")}
    for required in ("/healthz", "/webhook/calendly", "/webhook/whatsapp"):
        ok(f"route {required} mounted", required in paths)

    print()
    if _failed:
        print(f"✗ {_failed} test(s) failed.")
        return 1
    print("✓ All smoke tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
