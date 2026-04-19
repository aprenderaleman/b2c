-- =============================================================================
-- Migration 029 — manual classes_remaining adjustment for admins
-- =============================================================================
-- `students.classes_remaining` is computed from real attendance via the
-- trigger in migration 025. Admins sometimes need to tweak the number
-- by hand (awarded free classes, corrections, pre-platform credits…).
-- Adding a new column `classes_adjustment` that the trigger ALSO adds,
-- so the formula becomes:
--
--   remaining = purchased − consumed_via_attendance + adjustment
--
-- An audit table records who changed what and why so a year from now
-- we can always justify each delta.
-- =============================================================================

BEGIN;

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS classes_adjustment INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN students.classes_adjustment IS
    'Manual admin override. Positive = grant extra classes. Negative = remove. Sums into classes_remaining via the trigger.';

-- Audit table
CREATE TABLE IF NOT EXISTS student_class_adjustments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    admin_user_id   uuid REFERENCES users(id)  ON DELETE SET NULL,
    delta           INTEGER NOT NULL,        -- how much was added/removed in THIS adjustment
    reason          TEXT NOT NULL,           -- free-form note, required
    new_adjustment  INTEGER NOT NULL,        -- resulting students.classes_adjustment after the edit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_class_adjustments_student_idx
    ON student_class_adjustments(student_id, created_at DESC);

ALTER TABLE student_class_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_sca" ON student_class_adjustments;
CREATE POLICY "service_role_all_sca" ON student_class_adjustments
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Update the recompute helper + the two triggers so they factor in adjustment.
CREATE OR REPLACE FUNCTION recompute_classes_remaining(p_student_id uuid)
RETURNS void AS $$
BEGIN
    UPDATE students s
       SET classes_remaining = GREATEST(0,
              s.classes_purchased
              + s.classes_adjustment
              - COALESCE((
                  SELECT COUNT(*)::int
                    FROM class_participants cp
                    JOIN classes c ON c.id = cp.class_id
                   WHERE cp.student_id = s.id
                     AND cp.counts_as_session = TRUE
                     AND c.status = 'completed'
                     AND c.billed_hours > 0
              ), 0))
     WHERE s.id = p_student_id;
END;
$$ LANGUAGE plpgsql;

-- Also re-run the classes trigger function so bulk class status changes
-- still recompute from scratch using the new formula.
CREATE OR REPLACE FUNCTION tg_classes_sync_remaining() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND NEW.status = OLD.status AND NEW.billed_hours = OLD.billed_hours) THEN
        RETURN NEW;
    END IF;
    UPDATE students s
       SET classes_remaining = GREATEST(0,
              s.classes_purchased
              + s.classes_adjustment
              - COALESCE((
                  SELECT COUNT(*)::int
                    FROM class_participants cp
                    JOIN classes c ON c.id = cp.class_id
                   WHERE cp.student_id = s.id
                     AND cp.counts_as_session = TRUE
                     AND c.status = 'completed'
                     AND c.billed_hours > 0
              ), 0))
     WHERE s.id IN (
         SELECT student_id FROM class_participants WHERE class_id = NEW.id
     );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger directly on students.classes_adjustment so setting it from
-- SQL / the API also refreshes remaining without a manual recompute call.
CREATE OR REPLACE FUNCTION tg_students_adjustment_sync() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'UPDATE'
        AND NEW.classes_adjustment IS DISTINCT FROM OLD.classes_adjustment) THEN
        PERFORM recompute_classes_remaining(NEW.id);
    END IF;
    IF (TG_OP = 'UPDATE'
        AND NEW.classes_purchased IS DISTINCT FROM OLD.classes_purchased) THEN
        PERFORM recompute_classes_remaining(NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_adjustment_sync ON students;
CREATE TRIGGER students_adjustment_sync
    AFTER UPDATE OF classes_adjustment, classes_purchased ON students
    FOR EACH ROW EXECUTE FUNCTION tg_students_adjustment_sync();

-- Refresh every student so the new column (0 for all) re-syncs remaining
-- (functionally no change, but keeps invariants tight).
UPDATE students SET classes_adjustment = 0 WHERE classes_adjustment IS NULL;

-- Update v_student_packs so it surfaces the adjustment for reporting.
-- DROP first because the column order changed (PostgreSQL doesn't allow
-- reordering with CREATE OR REPLACE VIEW).
DROP VIEW IF EXISTS v_student_packs;
CREATE VIEW v_student_packs AS
SELECT
    s.id                                AS student_id,
    s.user_id,
    u.full_name,
    u.email,
    s.current_level,
    s.subscription_type,
    s.classes_purchased,
    s.classes_adjustment,
    s.pack_started_at,
    s.pack_expires_at,
    COALESCE(consumed.n, 0)             AS classes_consumed,
    s.classes_purchased
      + s.classes_adjustment
      - COALESCE(consumed.n, 0)         AS classes_remaining
FROM students s
JOIN users u ON u.id = s.user_id
LEFT JOIN LATERAL (
    SELECT COUNT(*)::INT AS n
      FROM class_participants cp
      JOIN classes c ON c.id = cp.class_id
     WHERE cp.student_id = s.id
       AND cp.counts_as_session = TRUE
       AND c.status = 'completed'
       AND c.billed_hours > 0
) consumed ON TRUE;

COMMIT;
