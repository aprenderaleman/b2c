-- Migration 051: auto-enroll group members into group classes
--
-- The Marina Valero case: her A1 group was created via the with-schedule
-- route, which inserts the group + classes + then calls
-- addStudentToGroup() to wire `class_participants`. If that final step
-- fails or is skipped (script paths, manual SQL, future refactors), the
-- student is silently invisible from /estudiante/clases because the
-- dashboard reads from class_participants — even though her group has
-- 59 future classes.
--
-- Defence in depth: enforce the invariant at the DB level so no code
-- path can break it.
--
--   Trigger A (on classes): when a class is inserted/updated with a
--     non-null group_id, ensure class_participants has a row for every
--     current member of that group.
--
--   Trigger B (on student_group_members): when a student joins a group,
--     ensure class_participants has a row for every FUTURE scheduled
--     class of that group. (Past classes preserve attendance history.)
--
--   Trigger C (on student_group_members DELETE): when a student leaves
--     a group, remove their class_participants from FUTURE scheduled
--     classes only.
--
-- All triggers use ON CONFLICT DO NOTHING so they are safe to run on
-- top of correct data (idempotent).

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- A. Class insert/update → enrol all current group members
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enroll_group_members_on_class()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only act when group_id is newly set / changed. On UPDATE, also act
  -- if scheduled_at moves from past to future (re-enable a recovered
  -- class).
  IF (TG_OP = 'UPDATE'
      AND COALESCE(OLD.group_id::text, '') = COALESCE(NEW.group_id::text, '')) THEN
    RETURN NEW;
  END IF;

  INSERT INTO class_participants (class_id, student_id, attended, counts_as_session)
  SELECT NEW.id, gm.student_id, NULL, TRUE
  FROM student_group_members gm
  WHERE gm.group_id = NEW.group_id
  ON CONFLICT (class_id, student_id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enroll_group_members_on_class ON classes;
CREATE TRIGGER trg_enroll_group_members_on_class
AFTER INSERT OR UPDATE OF group_id ON classes
FOR EACH ROW EXECUTE FUNCTION enroll_group_members_on_class();

-- ────────────────────────────────────────────────────────────────
-- B. Member join → enrol in all future scheduled classes
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enroll_member_into_future_group_classes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO class_participants (class_id, student_id, attended, counts_as_session)
  SELECT c.id, NEW.student_id, NULL, TRUE
  FROM classes c
  WHERE c.group_id = NEW.group_id
    AND c.status = 'scheduled'
    AND c.scheduled_at >= NOW()
  ON CONFLICT (class_id, student_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enroll_member_into_future_group_classes ON student_group_members;
CREATE TRIGGER trg_enroll_member_into_future_group_classes
AFTER INSERT ON student_group_members
FOR EACH ROW EXECUTE FUNCTION enroll_member_into_future_group_classes();

-- ────────────────────────────────────────────────────────────────
-- C. Member leave → unenrol from future scheduled classes (audit-safe)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION unenroll_member_from_future_group_classes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM class_participants cp
  USING classes c
  WHERE cp.class_id = c.id
    AND cp.student_id = OLD.student_id
    AND c.group_id = OLD.group_id
    AND c.status = 'scheduled'
    AND c.scheduled_at >= NOW();
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_unenroll_member_from_future_group_classes ON student_group_members;
CREATE TRIGGER trg_unenroll_member_from_future_group_classes
AFTER DELETE ON student_group_members
FOR EACH ROW EXECUTE FUNCTION unenroll_member_from_future_group_classes();

COMMIT;
