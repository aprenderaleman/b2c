-- =============================================================================
-- Migration 036 — short magic-link code for trial classes
-- =============================================================================
-- The full magic-link URL we send to leads carries a long HMAC-signed
-- token (~250 chars), which on WhatsApp looks like a phishing link
-- and damages trust. Add a short opaque code on each class so we
-- can serve the same magic link from /c/{code} (~40 chars total).
--
-- The code is ONLY used as a lookup key; the auth identity is still
-- materialised server-side from `classes.lead_id`.
-- =============================================================================

BEGIN;

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS short_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS classes_short_code_uidx
    ON classes (short_code)
    WHERE short_code IS NOT NULL;

COMMIT;
