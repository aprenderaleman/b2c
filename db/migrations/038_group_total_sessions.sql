-- =============================================================================
-- Migration 038 — student_groups.total_sessions
-- =============================================================================
-- The admin defines a group at creation time with a target number of
-- sessions (e.g. 50). The system tracks how many have been given so
-- far by counting completed classes for the group, and shows
-- "12 / 50 clases dadas" on the group card.
--
-- Optional column — NULL means the admin didn't pin a target (open-ended
-- recurrence end-date model still works).
-- =============================================================================

BEGIN;

ALTER TABLE student_groups
    ADD COLUMN IF NOT EXISTS total_sessions INTEGER
        CHECK (total_sessions IS NULL OR total_sessions >= 1);

COMMENT ON COLUMN student_groups.total_sessions IS
    'Total number of sessions the admin committed to for this group. NULL if no target was set. Used by /admin/grupos to render progress (count(classes WHERE group_id = X AND status = ''completed'') / total_sessions). Bumped when the admin extends the series via /api/admin/classes/[id]/extend.';

COMMIT;
