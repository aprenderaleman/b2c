"""
Agent 2 — AUTHORIZATION AGENT (El Revisor).

Two paths:
  * Templates (contact_1, contact_2, ai_fallback_reengagement) → auto-approve.
    The copy is fixed and reviewed by humans; paying for an LLM review would
    be pure waste.
  * AI-written drafts (ai_contact_3+, ai_conversation_reply) → batch LLM review
    via Haiku 4.5. Up to 5 drafts per API call (spec requirement).

The LLM reviewer runs a fixed checklist (coherence, tone, language match,
no pushiness, brief, signed as Stiv, Calendly link only when requested,
no grammar errors) and returns APPROVED / REJECTED with a reason per draft.

If a draft fails twice in a row, Agent 0 pauses the lead and alerts Gelfis
(escalation — handled by the caller using the timeline 'escalation' type).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from agents.agent_1_writer import MessageDraft
from agents.shared.claude_client import (
    BRAND_CONTEXT,
    MODEL_HAIKU,
    complete_json,
)

log = logging.getLogger("agent_2")


@dataclass
class ReviewResult:
    approved: bool
    reason: str = ""


_AUTO_APPROVE_KINDS = {
    "template_contact_1",
    "template_contact_2",
    "ai_fallback_reengagement",
}


_REVIEWER_SYSTEM = BRAND_CONTEXT + """

TASK: You are a strict final reviewer for outbound WhatsApp messages
drafted by a colleague. For EACH draft in the batch, decide whether it
passes the following checklist and can be sent to the lead:

  [1] Coherent with the lead's context (language, timeline, notes).
  [2] Tone: warm, professional, NEVER pushy or salesy.
  [3] Written in the lead's language (es/de) — no mixing.
  [4] Brief and direct — max 5 short lines / ~400 chars total.
  [5] Calendly URL https://calendly.com/aprenderaleman2026/sesion-de-prueba-de-aleman
      present ONLY if the lead already asked to book a trial class.
      If the draft includes it WITHOUT that signal → REJECT.
  [6] Signed as "Stiv" — anywhere in the message.
  [7] No grammar, spelling, or tone errors.

If ALL pass → approved=true, reason="".
If any fail → approved=false, reason is ONE brief sentence naming the
issue (e.g. "Added Calendly link without lead asking", "Switched to
English mid-message", "Sounds pushy in line 2"). No more than ~120 chars.
"""


# JSON schema: the model returns {"results": [{approved, reason}, ...]}
_REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "index":    {"type": "integer"},
                    "approved": {"type": "boolean"},
                    "reason":   {"type": "string"},
                },
                "required": ["index", "approved", "reason"],
            },
        }
    },
    "required": ["results"],
}


def _compact_lead(lead: dict) -> str:
    """Essential lead context for the reviewer — keep it lean."""
    return (
        f"name={lead.get('name')} lang={lead.get('language')} "
        f"level={lead.get('german_level')} goal={lead.get('goal')} "
        f"urgency={lead.get('urgency')} status={lead.get('status')} "
        f"contact_n={lead.get('current_followup_number')}"
    )


def _sanity_check(draft: MessageDraft) -> ReviewResult | None:
    """Fast pre-check without hitting the API. Returns a fail result or None."""
    text = (draft.text or "").strip()
    if not text:
        return ReviewResult(False, "empty_body")
    if len(text) > 1200:
        return ReviewResult(False, "body_too_long")
    return None


# ──────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────


def review_single(lead: dict, draft: MessageDraft) -> ReviewResult:
    fail = _sanity_check(draft)
    if fail:
        return fail
    if draft.kind in _AUTO_APPROVE_KINDS:
        return ReviewResult(True)
    return review_batch([(lead, draft)])[0]


def review_batch(pairs: list[tuple[dict, MessageDraft]]) -> list[ReviewResult]:
    """
    Review up to 5 drafts in a single Haiku call (per spec). If the list is
    larger than 5, we chunk internally.

    Pairs whose draft.kind is in _AUTO_APPROVE_KINDS short-circuit without
    hitting the API.
    """
    out: list[ReviewResult | None] = [None] * len(pairs)
    ai_indexes: list[int] = []

    # Fast pass: sanity checks + auto-approves.
    for i, (_, draft) in enumerate(pairs):
        fail = _sanity_check(draft)
        if fail:
            out[i] = fail
            continue
        if draft.kind in _AUTO_APPROVE_KINDS:
            out[i] = ReviewResult(True)
            continue
        ai_indexes.append(i)

    # Batch-review the remainder (5 at a time).
    for chunk_start in range(0, len(ai_indexes), 5):
        chunk = ai_indexes[chunk_start:chunk_start + 5]
        results = _review_ai_chunk([(pairs[i][0], pairs[i][1]) for i in chunk])
        for local_i, original_i in enumerate(chunk):
            out[original_i] = results[local_i] if local_i < len(results) \
                              else ReviewResult(False, "reviewer_missing_result")

    # Safety net: ensure no None sneaks through.
    return [r or ReviewResult(False, "reviewer_internal_error") for r in out]


def _review_ai_chunk(pairs: list[tuple[dict, MessageDraft]]) -> list[ReviewResult]:
    blocks: list[str] = []
    for i, (lead, draft) in enumerate(pairs):
        blocks.append(
            f"=== DRAFT {i} ===\n"
            f"LEAD CONTEXT: {_compact_lead(lead)}\n"
            f"KIND: {draft.kind}\n"
            f"LANGUAGE (expected): {draft.language}\n"
            f"DRAFT TEXT:\n{draft.text}\n"
        )
    user_prompt = (
        "Review the following drafts. Return a JSON object with a `results` "
        "array containing one entry per draft (indexed 0..N-1).\n\n"
        + "\n".join(blocks)
    )

    try:
        data, _usage = complete_json(
            model=MODEL_HAIKU,
            system=_REVIEWER_SYSTEM,
            user=user_prompt,
            schema=_REVIEW_SCHEMA,
            max_tokens=600,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("Agent 2 batch review failed: %s", e)
        # Fail-closed: reject all drafts in the chunk so nothing goes out
        # unreviewed.
        return [ReviewResult(False, "reviewer_api_error") for _ in pairs]

    results_raw = data.get("results") or []
    # Map back by `index`. Defensive: if the model drops entries, fill in
    # an error row so the caller doesn't index-shift.
    by_index: dict[int, ReviewResult] = {}
    for r in results_raw:
        try:
            i = int(r.get("index"))
            approved = bool(r.get("approved"))
            reason = str(r.get("reason") or "")[:300]
            by_index[i] = ReviewResult(approved=approved, reason=reason)
        except (TypeError, ValueError):
            continue

    return [
        by_index.get(i, ReviewResult(False, "reviewer_missing_result"))
        for i in range(len(pairs))
    ]
