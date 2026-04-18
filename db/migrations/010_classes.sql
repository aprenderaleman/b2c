-- =============================================================================
-- Migration 010 — classes
-- =============================================================================
-- One row per scheduled class session (live or recorded). Individual and group
-- classes share the same table; the difference is how many rows exist in
-- class_participants for a given class_id.
--
-- Recurrence: stored as a flat series. When admin creates "weekly Wed at 18:00
-- from Nov to Dec", we insert N rows with the same `parent_class_id` pointing
-- to the first row, so cancellations/edits can target either a single instance
-- or the whole series by walking parent_class_id.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE class_type AS ENUM ('individual', 'group');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE class_status AS ENUM (
        'scheduled',   -- default on create
        'live',        -- teacher joined the room
        'completed',   -- teacher ended or auto-end timer fired
        'cancelled',   -- admin / teacher cancelled ahead of time
        'absent'       -- nobody showed up
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE recurrence_pattern AS ENUM ('none', 'weekly', 'biweekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type                      class_type NOT NULL,
    teacher_id                uuid NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,

    -- When / how long
    scheduled_at              TIMESTAMPTZ NOT NULL,
    duration_minutes          INTEGER NOT NULL
                              CHECK (duration_minutes BETWEEN 15 AND 240),

    -- Recurrence: parent points at the first instance of a series. Single
    -- classes have parent_class_id = NULL. Recurrent series have every
    -- instance (including the first) linked to the first.
    recurrence_pattern        recurrence_pattern NOT NULL DEFAULT 'none',
    recurrence_end_date       DATE,
    parent_class_id           uuid REFERENCES classes(id) ON DELETE SET NULL,

    -- Display
    title                     TEXT NOT NULL,
    topic                     TEXT,

    -- Lifecycle
    status                    class_status NOT NULL DEFAULT 'scheduled',
    livekit_room_id           TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,

    -- Filled when the class actually runs (Phase 3)
    started_at                TIMESTAMPTZ,
    ended_at                  TIMESTAMPTZ,
    actual_duration_minutes   INTEGER,

    notes_admin               TEXT,
    created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS classes_teacher_idx       ON classes(teacher_id, scheduled_at);
CREATE INDEX IF NOT EXISTS classes_scheduled_at_idx  ON classes(scheduled_at);
CREATE INDEX IF NOT EXISTS classes_status_idx        ON classes(status) WHERE status IN ('scheduled', 'live');
CREATE INDEX IF NOT EXISTS classes_parent_idx        ON classes(parent_class_id) WHERE parent_class_id IS NOT NULL;

CREATE OR REPLACE FUNCTION tg_classes_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS classes_updated_at ON classes;
CREATE TRIGGER classes_updated_at
    BEFORE UPDATE ON classes
    FOR EACH ROW EXECUTE FUNCTION tg_classes_updated_at();

-- Blanket service-role policy (same pattern as migration 009).
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_classes" ON classes;
CREATE POLICY "service_role_all_classes" ON classes
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
