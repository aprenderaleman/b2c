-- =============================================================================
-- Migration 017 — homework
-- =============================================================================
-- Teachers assign homework attached to a class (individual or group).
-- Every student in that class's participants gets an assignment they can
-- submit to. Teacher reviews → grade + feedback.
-- =============================================================================

BEGIN;

DO $$ BEGIN
    CREATE TYPE homework_submission_status AS ENUM ('submitted', 'reviewed', 'needs_revision');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE homework_grade AS ENUM ('A', 'B', 'C', 'D', 'F');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- homework_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS homework_assignments (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id      uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_id    uuid NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,

    title         TEXT NOT NULL,
    description   TEXT,
    due_date      TIMESTAMPTZ,                                -- nullable = no deadline
    attachments   JSONB NOT NULL DEFAULT '[]'::JSONB,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS homework_assignments_class_idx ON homework_assignments(class_id);
CREATE INDEX IF NOT EXISTS homework_assignments_teacher_idx ON homework_assignments(teacher_id);

-- ---------------------------------------------------------------------------
-- homework_submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS homework_submissions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id    uuid NOT NULL REFERENCES homework_assignments(id) ON DELETE CASCADE,
    student_id       uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,

    content          TEXT,
    attachments      JSONB NOT NULL DEFAULT '[]'::JSONB,

    status           homework_submission_status NOT NULL DEFAULT 'submitted',
    teacher_feedback TEXT,
    grade            homework_grade,

    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at      TIMESTAMPTZ,

    UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS homework_submissions_student_idx ON homework_submissions(student_id);
CREATE INDEX IF NOT EXISTS homework_submissions_status_idx  ON homework_submissions(status);


-- RLS: service-role only for now
ALTER TABLE homework_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_submissions  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['homework_assignments','homework_submissions']) LOOP
        EXECUTE format($f$
            DROP POLICY IF EXISTS "service_role_all_%I" ON %I;
            CREATE POLICY "service_role_all_%I" ON %I
                FOR ALL
                USING (auth.role() = 'service_role')
                WITH CHECK (auth.role() = 'service_role');
        $f$, tbl, tbl, tbl, tbl);
    END LOOP;
END $$;

COMMIT;
