-- =============================================================================
-- Migration 025 — auto-sync students.classes_remaining
-- =============================================================================
-- students.classes_remaining exists since Phase 1 and is read by the whole
-- UI (estudiante home, admin, teacher views). With the new pack model we
-- compute it from real attendance in the view v_student_packs, but legacy
-- code still reads the stored column.
--
-- Instead of touching every callsite, a trigger keeps the column in sync
-- whenever:
--   - class_participants rows change (INSERT / UPDATE of counts_as_session / DELETE)
--   - a class transitions to/from status='completed' or billed_hours changes
--
-- Also performs a one-shot sync so the stored column matches reality NOW.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: recompute classes_remaining for a given student
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recompute_classes_remaining(p_student_id uuid)
RETURNS void AS $$
BEGIN
    UPDATE students s
       SET classes_remaining = GREATEST(0,
              s.classes_purchased - COALESCE((
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

-- ---------------------------------------------------------------------------
-- Trigger on class_participants: one student affected per row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tg_cp_sync_remaining() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recompute_classes_remaining(OLD.student_id);
        RETURN OLD;
    END IF;
    PERFORM recompute_classes_remaining(NEW.student_id);
    IF TG_OP = 'UPDATE' AND OLD.student_id IS DISTINCT FROM NEW.student_id THEN
        PERFORM recompute_classes_remaining(OLD.student_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cp_sync_remaining ON class_participants;
CREATE TRIGGER cp_sync_remaining
    AFTER INSERT OR UPDATE OR DELETE ON class_participants
    FOR EACH ROW EXECUTE FUNCTION tg_cp_sync_remaining();

-- ---------------------------------------------------------------------------
-- Trigger on classes: when status / billed_hours changes, affects every
-- participant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tg_classes_sync_remaining() RETURNS trigger AS $$
BEGIN
    -- Only recompute when something that actually affects counting changes
    IF (TG_OP = 'UPDATE' AND NEW.status = OLD.status AND NEW.billed_hours = OLD.billed_hours) THEN
        RETURN NEW;
    END IF;
    UPDATE students s
       SET classes_remaining = GREATEST(0,
              s.classes_purchased - COALESCE((
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

DROP TRIGGER IF EXISTS classes_sync_remaining ON classes;
CREATE TRIGGER classes_sync_remaining
    AFTER UPDATE OF status, billed_hours ON classes
    FOR EACH ROW EXECUTE FUNCTION tg_classes_sync_remaining();

-- ---------------------------------------------------------------------------
-- One-shot initial sync
-- ---------------------------------------------------------------------------
UPDATE students s
   SET classes_remaining = GREATEST(0,
          s.classes_purchased - COALESCE((
              SELECT COUNT(*)::int
                FROM class_participants cp
                JOIN classes c ON c.id = cp.class_id
               WHERE cp.student_id = s.id
                 AND cp.counts_as_session = TRUE
                 AND c.status = 'completed'
                 AND c.billed_hours > 0
          ), 0));

COMMIT;
