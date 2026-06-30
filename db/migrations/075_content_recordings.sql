-- Migration 075 — content recording sessions
--
-- Adds is_content_recording flag to classes so teachers can create
-- solo LiveKit sessions for recording YouTube content. Reuses the
-- entire existing recording pipeline (egress → R2 → signed URLs).

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS is_content_recording BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS classes_content_recording_idx
    ON classes(is_content_recording) WHERE is_content_recording = TRUE;

COMMENT ON COLUMN classes.is_content_recording IS
  'True for solo recording sessions (YouTube content). No students, no billing.';
