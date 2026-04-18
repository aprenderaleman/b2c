"""
Central Claude API wrapper — every AI call in the system goes through here.

Responsibilities:
  * Single Anthropic client instance (connection pooling).
  * Consistent prompt caching for the stable system prefix.
  * Model selection helpers (Haiku for reviewers, Sonnet for writers).
  * Usage logging so we can audit credit consumption.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

import anthropic
from dotenv import load_dotenv

# Override=True: shell-set empty strings should not mask real values in .env.
load_dotenv(override=True)

log = logging.getLogger("claude")

_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
    return _client


# ──────────────────────────────────────────────────────────
# Model IDs (kept in one place so we can bump them uniformly)
# ──────────────────────────────────────────────────────────

MODEL_HAIKU  = os.environ.get("CLAUDE_MODEL_HAIKU",  "claude-haiku-4-5")
MODEL_SONNET = os.environ.get("CLAUDE_MODEL_SONNET", "claude-sonnet-4-6")


# ──────────────────────────────────────────────────────────
# Response cache (DB-backed, 24h TTL)
# ──────────────────────────────────────────────────────────

def normalize_question(q: str) -> str:
    """Normalize a user question for cache lookup — strip punctuation,
    lowercase, collapse whitespace. Not perfect, but good enough for
    high-frequency simple asks (precio, duración, horarios, Schule, Hans…)."""
    import re
    cleaned = re.sub(r"[^\wáéíóúüñÁÉÍÓÚÜÑß]+", " ", q.lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


def question_hash(q: str) -> str:
    return hashlib.sha256(normalize_question(q).encode("utf-8")).hexdigest()


def lookup_cached_response(q: str, lang: str) -> str | None:
    """Return cached response if it exists and is < 24h old."""
    from .db import get_conn
    h = question_hash(q)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT response_es, response_de
              FROM response_cache
             WHERE question_hash = %s
               AND cached_at > NOW() - INTERVAL '24 hours'
            """,
            (h,),
        )
        row = cur.fetchone()
        if not row:
            return None
        # Bump hit_count
        cur.execute(
            "UPDATE response_cache SET hit_count = hit_count + 1 WHERE question_hash = %s",
            (h,),
        )
    return row["response_de"] if lang == "de" else row["response_es"]


def store_cached_response(q: str, response_es: str, response_de: str) -> None:
    from .db import get_conn
    h = question_hash(q)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO response_cache
                (question_hash, question_raw, response_es, response_de, cached_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (question_hash) DO UPDATE
               SET response_es = EXCLUDED.response_es,
                   response_de = EXCLUDED.response_de,
                   cached_at   = NOW()
            """,
            (h, q[:500], response_es, response_de),
        )


# ──────────────────────────────────────────────────────────
# Brand / voice — stable across all prompts, cacheable prefix.
# ──────────────────────────────────────────────────────────

BRAND_CONTEXT = """\
You are helping "Stiv", a human adviser at Aprender-Aleman.de — an online
Premium German academy specialized in teaching German to Spanish speakers.
Key facts you can draw on when relevant:

  - Native German teachers (Germany / Switzerland) who also speak Spanish.
  - Intensive and flexible courses, personalized plans for visa / work /
    studies / official exams in DACH (Germany / Austria / Switzerland).
  - Hans: an AI professor available 24/7 via voice and text.
  - SCHULE: the complete virtual learning platform, included with courses.
    URL: https://schule.aprender-aleman.de
  - Preparation for official exams (Goethe, TELC).
  - **Public website with full info** (prices, methodology, teachers,
    course catalog): https://aprender-aleman.de
  - Trial class booking link (send ONLY when the lead clearly asks to book):
    https://calendly.com/aprenderaleman2026/sesion-de-prueba-de-aleman

Voice rules — non-negotiable:
  - Short and direct. No marketing fluff, no emojis beyond one friendly
    accent at most. Maximum ~4 short paragraphs.
  - **Use blank lines between paragraphs** so WhatsApp renders the message
    readable (separate greeting, context, question, sign-off with empty
    lines). NEVER write one dense blob of text.
  - Warm and professional, never pushy or salesy.
  - Never invent discounts, schedules, durations or prices you aren't told.
  - **End every outbound message with exactly this signature on its own
    final line, preceded by a blank line:**

        Stiv, Aprender-Aleman.de

  - Answer in the lead's language: "es" = Spanish, "de" = German. Never mix.
  - Only send the Calendly link when the lead has *asked* to book. If they
    are still exploring, invite them instead.
  - **If the lead asks for broad info** (prices, curriculum, teachers,
    methodology, "tell me more", "send me info", "la web"), point them to
    https://aprender-aleman.de with a one-line suggestion rather than
    trying to explain everything in WhatsApp. Keep your message short and
    end with an invitation to ask follow-up questions.
"""


# ──────────────────────────────────────────────────────────
# Generic request helpers with prompt caching
# ──────────────────────────────────────────────────────────

def complete_text(
    *,
    model: str,
    system: str,
    user: str,
    max_tokens: int = 600,
    cache_system: bool = True,
) -> tuple[str, dict[str, int]]:
    """
    Simple text completion. Returns (text, usage) where usage is the
    input_tokens / cache_read_input_tokens / cache_creation_input_tokens /
    output_tokens breakdown.

    The system prompt is marked cacheable by default — repeat calls with the
    same `system` content will hit the cache and cost ~0.1x.
    """
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": user}],
    }
    if cache_system:
        kwargs["system"] = [
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ]
    else:
        kwargs["system"] = system

    resp = client().messages.create(**kwargs)

    text_parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    text = "\n".join(text_parts).strip()

    usage = {
        "input_tokens":                 getattr(resp.usage, "input_tokens", 0) or 0,
        "output_tokens":                getattr(resp.usage, "output_tokens", 0) or 0,
        "cache_creation_input_tokens":  getattr(resp.usage, "cache_creation_input_tokens", 0) or 0,
        "cache_read_input_tokens":      getattr(resp.usage, "cache_read_input_tokens", 0) or 0,
    }
    log.info("claude call model=%s usage=%s", model, usage)
    return text, usage


def complete_json(
    *,
    model: str,
    system: str,
    user: str,
    schema: dict[str, Any],
    max_tokens: int = 800,
    cache_system: bool = True,
) -> tuple[dict[str, Any], dict[str, int]]:
    """
    Structured-output call. We ask for JSON-only output in the system prompt
    and parse what we get back. We deliberately avoid the SDK's output_config
    feature to stay compatible with older anthropic SDK versions.
    """
    # Append a JSON-only instruction + the schema so the model knows the shape.
    json_system = (
        system
        + "\n\nOUTPUT FORMAT:\n"
        + "Return ONLY valid JSON matching this JSON Schema (no prose, no code fences):\n"
        + json.dumps(schema, ensure_ascii=False)
    )

    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": user}],
    }
    if cache_system:
        kwargs["system"] = [
            {"type": "text", "text": json_system, "cache_control": {"type": "ephemeral"}}
        ]
    else:
        kwargs["system"] = json_system

    resp = client().messages.create(**kwargs)
    text = "\n".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
    # Tolerate accidental code fences
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Model returned invalid JSON: {e}\n{text[:500]}") from e

    usage = {
        "input_tokens":                 getattr(resp.usage, "input_tokens", 0) or 0,
        "output_tokens":                getattr(resp.usage, "output_tokens", 0) or 0,
        "cache_creation_input_tokens":  getattr(resp.usage, "cache_creation_input_tokens", 0) or 0,
        "cache_read_input_tokens":      getattr(resp.usage, "cache_read_input_tokens", 0) or 0,
    }
    log.info("claude json model=%s usage=%s", model, usage)
    return data, usage
