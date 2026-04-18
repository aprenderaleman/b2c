-- =============================================================================
-- Migration 019 — teacher_student_notes
-- =============================================================================
-- Private notes a teacher writes about a student (class summary, progress
-- observation, behaviour comment, general). Not visible to the student.
-- =============================================================================

BEGIN;

DO $$ BEGIN
    CREATE TYPE teacher_note_type AS ENUM ('class_summary', 'progress', 'behavior', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS teacher_student_notes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id  uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id    uuid REFERENCES classes(id) ON DELETE SET NULL,  -- nullable: general note
    note_type   teacher_note_type NOT NULL DEFAULT 'general',
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tsn_student_idx
    ON teacher_student_notes(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tsn_teacher_idx
    ON teacher_student_notes(teacher_id);

ALTER TABLE teacher_student_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_teacher_student_notes" ON teacher_student_notes;
CREATE POLICY "service_role_all_teacher_student_notes" ON teacher_student_notes
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
