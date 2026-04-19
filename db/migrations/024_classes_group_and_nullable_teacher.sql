-- =============================================================================
-- Migration 024 — classes · group link + nullable teacher
-- =============================================================================
-- Two small structural changes to let us backfill historical data cleanly and
-- to make group-centric queries trivial going forward:
--
--   1. classes.group_id → student_groups(id). Lets the admin UI list
--      "upcoming classes of group X" without walking class_participants.
--   2. classes.teacher_id becomes nullable — needed for archived sessions
--      that belonged to teachers we no longer work with (e.g. Martin Bielke
--      teaching the now-deleted Nachmittags group).
-- =============================================================================

BEGIN;

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES student_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS classes_group_idx ON classes(group_id) WHERE group_id IS NOT NULL;

ALTER TABLE classes ALTER COLUMN teacher_id DROP NOT NULL;

COMMIT;
