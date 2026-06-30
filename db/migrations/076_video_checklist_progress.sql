-- Migration 076 — video checklist progress
--
-- Tracks which monthly video checklist items each teacher has completed.
-- The checklist items themselves live in code (web/lib/video-checklist.ts).

CREATE TABLE IF NOT EXISTS video_checklist_progress (
    teacher_id   UUID        NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    item_key     TEXT        NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (teacher_id, item_key)
);
