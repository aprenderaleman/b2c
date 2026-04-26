-- =============================================================================
-- Migration 031 — scheduling support for admin_broadcasts
-- =============================================================================
-- Adds two columns so a broadcast can be queued for later instead of
-- firing immediately:
--
--   scheduled_at  — when the cron should pick it up. NULL means the row
--                   was sent immediately (no scheduling involved).
--   status        — lifecycle: queued -> sending -> sent | failed.
--                   Pre-existing rows default to 'sent' so historical data
--                   stays consistent without a backfill.
--
-- A partial index keeps the cron's "anything due?" query fast even if the
-- table grows: it only needs to scan rows currently in 'queued'.
-- =============================================================================

BEGIN;

ALTER TABLE admin_broadcasts
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'sent'
        CHECK (status IN ('queued','sending','sent','failed'));

-- Fast lookup for the dispatch cron — only the queued rows are interesting.
CREATE INDEX IF NOT EXISTS admin_broadcasts_due_idx
    ON admin_broadcasts(scheduled_at)
    WHERE status = 'queued';

COMMENT ON COLUMN admin_broadcasts.scheduled_at IS
    'When this broadcast should be dispatched. NULL = it was sent immediately. Set with status=queued for deferred sends.';
COMMENT ON COLUMN admin_broadcasts.status IS
    'Lifecycle: queued -> sending -> sent | failed. Pre-existing rows default to sent.';

COMMIT;
