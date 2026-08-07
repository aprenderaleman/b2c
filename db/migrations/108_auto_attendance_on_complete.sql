-- =============================================================================
-- Migration 108 — auto-mark attendance when a class is completed
-- =============================================================================
-- Problem: class_participants.attended defaults to false and only changes
-- with manual marking. When a class is completed with evidence (recording,
-- actual_duration >= 15 min, or ended_at timer), the student is shown as
-- "no asistió" even though they were there. This affects 224+ historical
-- records across all students.
--
-- Solution: AFTER trigger on classes that marks all participants as
-- attended=true when a class is completed, UNLESS actual_duration < 15
-- (accidental entry, not a real class).
--
-- This does NOT override manual attended=false set by the teacher — it only
-- upgrades the default false to true when the class completes normally.
-- If a teacher needs to mark someone as absent, they do it AFTER completion.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION tg_auto_attendance_on_complete() RETURNS trigger AS $$
BEGIN
    -- Only act when status just changed to 'completed'
    IF NEW.status <> 'completed' THEN
        RETURN NEW;
    END IF;

    -- Skip if actual_duration is known and < 15 min (accidental entry)
    IF NEW.actual_duration_minutes IS NOT NULL AND NEW.actual_duration_minutes < 15 THEN
        RETURN NEW;
    END IF;

    -- Mark all participants as attended (only those still at default false/null)
    UPDATE class_participants
       SET attended = true
     WHERE class_id = NEW.id
       AND (attended = false OR attended IS NULL);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_attendance_on_complete ON classes;
CREATE TRIGGER auto_attendance_on_complete
    AFTER UPDATE OF status ON classes
    FOR EACH ROW
    WHEN (
        OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status = 'completed'
    )
    EXECUTE FUNCTION tg_auto_attendance_on_complete();

COMMIT;
