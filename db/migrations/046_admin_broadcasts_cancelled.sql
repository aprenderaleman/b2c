-- =============================================================================
-- Migration 046 — admin_broadcasts.status: add 'cancelled'
-- =============================================================================
-- The dispatch cron only acts on rows with status='queued', so adding a
-- new terminal state for "the admin pulled the plug before send time"
-- doesn't risk double-sending. We keep 'failed' for "we tried and it
-- broke" and use 'cancelled' for "user changed their mind".
-- =============================================================================

BEGIN;

ALTER TABLE admin_broadcasts
    DROP CONSTRAINT IF EXISTS admin_broadcasts_status_check;

ALTER TABLE admin_broadcasts
    ADD CONSTRAINT admin_broadcasts_status_check
    CHECK (status IN ('queued','sending','sent','failed','cancelled'));

COMMENT ON COLUMN admin_broadcasts.status IS
    'Lifecycle: queued -> sending -> sent | failed. queued -> cancelled when the admin aborts before dispatch. Pre-existing rows default to sent.';

COMMIT;
