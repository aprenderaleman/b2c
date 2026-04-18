-- =============================================================================
-- Migration 012 — teacher_availability
-- =============================================================================
-- Weekly recurring availability windows set by the teacher themselves.
-- Admin reads this when scheduling classes to see hints like "this teacher
-- typically works Wednesdays 14:00-18:00". We do NOT auto-block anything on
-- the admin side — availability is advisory, admin has final say.
--
-- valid_from / valid_until let teachers seasonally change their hours
-- (e.g. summer schedule) without deleting their base pattern.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS teacher_availability (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id    uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,

    -- 0 = Sunday, 1 = Monday, … 6 = Saturday (ISO-ish, matches JS getDay)
    day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),

    start_time    TIME NOT NULL,
    end_time      TIME NOT NULL CHECK (end_time > start_time),

    -- available=true means "I'm free in this slot"; false lets teachers mark
    -- a specific block as explicitly unavailable to override a broader rule.
    available     BOOLEAN NOT NULL DEFAULT TRUE,

    valid_from    DATE,
    valid_until   DATE,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_availability_teacher_idx
    ON teacher_availability(teacher_id, day_of_week);

CREATE OR REPLACE FUNCTION tg_teacher_availability_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teacher_availability_updated_at ON teacher_availability;
CREATE TRIGGER teacher_availability_updated_at
    BEFORE UPDATE ON teacher_availability
    FOR EACH ROW EXECUTE FUNCTION tg_teacher_availability_updated_at();

ALTER TABLE teacher_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_teacher_availability" ON teacher_availability;
CREATE POLICY "service_role_all_teacher_availability" ON teacher_availability
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
