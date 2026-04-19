-- =============================================================================
-- Migration 022 — student_groups
-- =============================================================================
-- Ports the "group" concept from the legacy platform: a named cohort of
-- students that share a teacher, a recurring schedule and a meeting link.
-- In the new model, actual class sessions live in `classes`; a group is the
-- "parent container" used to organise students and to scaffold future
-- recurring classes.
--
-- Same columns as the legacy table, adapted to our conventions (uuid PKs,
-- snake_case, foreign keys into users/teachers/students instead of raw ids).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- student_groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_groups (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT NOT NULL,
    capacity           INTEGER NOT NULL DEFAULT 1
                       CHECK (capacity >= 1),
    class_type         class_type NOT NULL DEFAULT 'group',
    level              cefr_level,
    teacher_id         uuid REFERENCES teachers(id) ON DELETE SET NULL,

    start_date         DATE,
    end_date           DATE,

    meet_link          TEXT,
    document_url       TEXT,

    active             BOOLEAN NOT NULL DEFAULT TRUE,
    notes              TEXT,

    -- Provenance, so we can audit re-runs of the migration.
    legacy_id          TEXT UNIQUE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_groups_teacher_idx ON student_groups(teacher_id);
CREATE INDEX IF NOT EXISTS student_groups_active_idx  ON student_groups(active)
    WHERE active = TRUE;

CREATE OR REPLACE FUNCTION tg_student_groups_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS student_groups_updated_at ON student_groups;
CREATE TRIGGER student_groups_updated_at
    BEFORE UPDATE ON student_groups
    FOR EACH ROW EXECUTE FUNCTION tg_student_groups_updated_at();


-- ---------------------------------------------------------------------------
-- student_group_members
--    Composite-PK join; simple because a member is either in the group or not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_group_members (
    group_id    uuid NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
    student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS sgm_student_idx ON student_group_members(student_id);


-- ---------------------------------------------------------------------------
-- RLS — service_role only (same pattern as the rest of the LMS)
-- ---------------------------------------------------------------------------
ALTER TABLE student_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_student_groups" ON student_groups;
CREATE POLICY "service_role_all_student_groups" ON student_groups
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_all_sgm" ON student_group_members;
CREATE POLICY "service_role_all_sgm" ON student_group_members
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
