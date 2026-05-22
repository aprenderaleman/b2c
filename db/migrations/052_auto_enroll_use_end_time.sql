-- Migration 052: fix triggers 051 to use class END time, not start.
--
-- Edge case: Marina Valero's group had a class at 18:00 Berlin TODAY.
-- The backfill + trigger B used `scheduled_at >= NOW()` which excludes
-- a class as soon as the start time passes — even though the class is
-- still running (50 min duration). Result: estudiante con la clase ya
-- en curso no podía entrar al aula porque no estaba en
-- class_participants.
--
-- Correct rule: enrol the student as long as the class hasn't ENDED.

BEGIN;

CREATE OR REPLACE FUNCTION enroll_member_into_future_group_classes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO class_participants (class_id, student_id, attended, counts_as_session)
  SELECT c.id, NEW.student_id, NULL, TRUE
  FROM classes c
  WHERE c.group_id = NEW.group_id
    AND c.status = 'scheduled'
    AND c.scheduled_at + (c.duration_minutes * INTERVAL '1 minute') >= NOW()
  ON CONFLICT (class_id, student_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION unenroll_member_from_future_group_classes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only future + in-progress classes; past (already ended) classes
  -- preserve attendance history.
  DELETE FROM class_participants cp
  USING classes c
  WHERE cp.class_id = c.id
    AND cp.student_id = OLD.student_id
    AND c.group_id = OLD.group_id
    AND c.status = 'scheduled'
    AND c.scheduled_at + (c.duration_minutes * INTERVAL '1 minute') >= NOW();
  RETURN OLD;
END $$;

COMMIT;
