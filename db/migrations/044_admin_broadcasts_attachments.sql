-- =============================================================================
-- Migration 044 — attachments on admin_broadcasts
-- =============================================================================
-- Adds an `attachments` JSONB column so a broadcast can carry file
-- references alongside the markdown body. Files live in the `materials`
-- Supabase bucket under `comunicados/<adminUserId>/<uuid>-<filename>`.
-- The column stores ONLY metadata (path/name/size/content_type) — the
-- send routes/cron download the actual bytes at send time.
--
-- Shape: [{ path, name, size, content_type }]
-- =============================================================================

BEGIN;

ALTER TABLE admin_broadcasts
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN admin_broadcasts.attachments IS
    'File references attached to email sends. Shape: [{path,name,size,content_type}]. Files live in the materials bucket; this column only stores metadata.';

COMMIT;
