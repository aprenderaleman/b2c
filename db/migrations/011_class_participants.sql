-- =============================================================================
-- Migration 011 — class_participants
-- =============================================================================
-- Links classes to the students attending. For individual classes there's
-- exactly one row per class; for groups, as many as there are students.
-- Attendance columns are filled when the class runs (Phase 3).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS class_participants (
    class_id     uuid NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
    student_id   uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,

    -- NULL until the class actually happens.
    attended     BOOLEAN,
    joined_at    TIMESTAMPTZ,
    left_at      TIMESTAMPTZ,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (class_id, student_id)
);

CREATE INDEX IF NOT EXISTS class_participants_student_idx
    ON class_participants(student_id);

ALTER TABLE class_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_class_participants" ON class_participants;
CREATE POLICY "service_role_all_class_participants" ON class_participants
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
