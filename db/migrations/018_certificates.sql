-- =============================================================================
-- Migration 018 — certificates
-- =============================================================================
-- Auto-issued when a student hits a milestone (e.g. 50 classes attended),
-- or manually issued by admin (e.g. passed official exam). PDF generated
-- on-demand by the server; we store the metadata here.
-- =============================================================================

BEGIN;

DO $$ BEGIN
    CREATE TYPE certificate_type AS ENUM (
        'classes_50',
        'classes_100',
        'level_a2',
        'level_b1',
        'level_b2',
        'level_c1',
        'exam_passed'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS certificates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type          certificate_type NOT NULL,

    title         TEXT NOT NULL,
    description   TEXT,
    -- Exam name / specific detail for manually-issued certs
    extra_label   TEXT,

    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    issued_by     uuid REFERENCES users(id) ON DELETE SET NULL,   -- null = auto

    UNIQUE (student_id, type, extra_label)
);

CREATE INDEX IF NOT EXISTS certificates_student_idx ON certificates(student_id, issued_at DESC);

ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_certificates" ON certificates;
CREATE POLICY "service_role_all_certificates" ON certificates
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
