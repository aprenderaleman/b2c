-- =============================================================================
-- Migration 109 — fix auto-attendance trigger to respect manual absences
-- =============================================================================
-- Problem: trigger 108 marks ALL participants as attended=true when a class
-- completes, including those manually marked attended=false (absent).
-- This means attendance is always ~100% — absences get overwritten.
--
-- Fix: only upgrade attended from NULL to true. Leave false (manual absence)
-- untouched. Teachers mark absence BEFORE completing the class, and the
-- trigger respects that.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION tg_auto_attendance_on_complete() RETURNS trigger AS $$
BEGIN
    IF NEW.status <> 'completed' THEN
        RETURN NEW;
    END IF;

    IF NEW.actual_duration_minutes IS NOT NULL AND NEW.actual_duration_minutes < 15 THEN
        RETURN NEW;
    END IF;

    -- Only mark attended for participants not yet marked (NULL).
    -- Leave attended=false (manual absence) untouched.
    UPDATE class_participants
       SET attended = true
     WHERE class_id = NEW.id
       AND attended IS NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
