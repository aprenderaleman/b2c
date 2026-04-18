-- =============================================================================
-- Migration 014 — recordings
-- =============================================================================
-- One row per completed recording. LiveKit Egress calls our webhook when a
-- recording finishes uploading to Hetzner Object Storage, at which point we
-- insert the row (status='ready') with the file URL + bytes + duration.
--
-- While the recording is being processed we may insert a row with
-- status='processing' (no file_url yet) so the class detail page can show
-- a "procesando…" badge.
-- =============================================================================

BEGIN;

DO $$ BEGIN
    CREATE TYPE recording_status AS ENUM ('processing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS recordings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id          uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,

    -- File location (Hetzner Object Storage, S3-compatible)
    file_url          TEXT,
    file_size_bytes   BIGINT,
    duration_seconds  INTEGER,

    -- Lifecycle
    status            recording_status NOT NULL DEFAULT 'processing',
    error             TEXT,                         -- populated when status='failed'

    -- LiveKit egress identifiers (for reconciliation / debugging)
    egress_id         TEXT UNIQUE,

    -- Access control: can students download the mp4?
    downloadable      BOOLEAN NOT NULL DEFAULT FALSE,

    processed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recordings_class_idx  ON recordings(class_id);
CREATE INDEX IF NOT EXISTS recordings_status_idx ON recordings(status);

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_recordings" ON recordings;
CREATE POLICY "service_role_all_recordings" ON recordings
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
