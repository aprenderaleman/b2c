-- =============================================================================
-- Migration 028 — users.ical_token
-- =============================================================================
-- Personal secret token used to build a per-user iCal feed URL:
--   /api/ical/{token}.ics  →  RFC-5545 feed of that user's upcoming classes
-- Google Calendar, Apple Calendar, Outlook can subscribe to that URL and
-- refresh once a day.
-- =============================================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ical_token TEXT UNIQUE;

-- Backfill: every existing user gets a 32-char random token.
UPDATE users
   SET ical_token = encode(gen_random_bytes(24), 'hex')
 WHERE ical_token IS NULL;

ALTER TABLE users
    ALTER COLUMN ical_token SET NOT NULL;

CREATE INDEX IF NOT EXISTS users_ical_token_idx ON users(ical_token);

COMMIT;
