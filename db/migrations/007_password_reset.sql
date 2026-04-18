-- =============================================================================
-- Migration 007 — password_reset_tokens
-- =============================================================================
-- Single-use tokens emailed to users who clicked "I forgot my password".
-- 1 hour expiry. Consumed on first use.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,    -- sha256 of the raw token; raw token only lives in the email
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,              -- null = unused
    requested_ip TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
    ON password_reset_tokens(user_id);

-- Cleanup helper (call from a cron-like job or admin endpoint):
--   DELETE FROM password_reset_tokens
--    WHERE expires_at < now() - interval '7 days';

COMMIT;
