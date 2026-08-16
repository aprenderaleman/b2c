-- Migration 112: Automatic class tracking
-- Adds room lifecycle tracking and duplicate prevention

-- 1. Track LiveKit room open/close times for audit trail
ALTER TABLE classes ADD COLUMN IF NOT EXISTS room_opened_at  TIMESTAMPTZ;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS room_closed_at  TIMESTAMPTZ;

-- 2. Prevent duplicate classes: same student can't have two classes
--    within 30 minutes of each other with the same teacher.
--    This is a function-based approach since we need fuzzy matching.
CREATE OR REPLACE FUNCTION check_class_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_scheduled_at TIMESTAMPTZ;
  v_teacher_id   UUID;
  v_is_trial     BOOLEAN;
  v_overlap_id   UUID;
BEGIN
  SELECT scheduled_at, teacher_id, is_trial
    INTO v_scheduled_at, v_teacher_id, v_is_trial
    FROM classes WHERE id = NEW.class_id;

  -- Skip check for trials
  IF v_is_trial THEN RETURN NEW; END IF;

  -- Look for another completed/scheduled/live class for the same
  -- student+teacher within ±30 minutes
  SELECT c.id INTO v_overlap_id
    FROM classes c
    JOIN class_participants cp ON cp.class_id = c.id
   WHERE cp.student_id = NEW.student_id
     AND c.teacher_id  = v_teacher_id
     AND c.id         != NEW.class_id
     AND c.status     IN ('scheduled', 'live', 'completed')
     AND ABS(EXTRACT(EPOCH FROM (c.scheduled_at - v_scheduled_at))) < 1800
   LIMIT 1;

  IF v_overlap_id IS NOT NULL THEN
    RAISE EXCEPTION 'Clase solapada: el estudiante ya tiene una clase a ±30min (class_id=%)', v_overlap_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_check_class_overlap ON class_participants;
CREATE TRIGGER tg_check_class_overlap
  BEFORE INSERT ON class_participants
  FOR EACH ROW EXECUTE FUNCTION check_class_overlap();
