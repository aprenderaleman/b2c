-- =============================================================================
-- Migration 032 — per-user "no me mandes nada" opt-out
-- =============================================================================
-- Sabine asked to stop receiving emails and in-app notifications entirely.
-- Rather than hard-code her user id anywhere, we add a flag on `users`
-- so any sender (class reminders, welcome emails, bell notifications,
-- future broadcasts) can check it and skip.
--
-- Does NOT affect the academy operating — the user still sees their
-- dashboard, can log in, etc. We just stop PUSHING anything to them.
-- =============================================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notifications_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.notifications_opt_out IS
    'When TRUE, skip all programmatic emails + in-app notifications for this user. They can still use the platform normally; we just do not push anything outbound.';

-- Sabine explicitly opted out (2026-04-24).
UPDATE users
   SET notifications_opt_out = TRUE
 WHERE LOWER(email) = 'coyotemoonyoga@gmail.com';

COMMIT;
