-- =============================================================================
-- Migration 044 — classes_remaining counts BILLED HOURS, not class count
-- =============================================================================
-- Universal rule confirmed by Gelfis 2026-05-02:
--   1 academic class = 50 minutes
--   A 100-min session consumes 2 classes from the student
--   A 50-min session consumes 1
--
-- Until now `recompute_classes_remaining` did COUNT(*) of completed classes,
-- so a 2h session and a 50-min session each subtracted only 1 from the
-- student. That's wrong — the long session should subtract 2 (or more).
--
-- Fix: change the formula to use SUM(billed_hours), where billed_hours is
-- already the canonical "units consumed" (set by lib/finance.ts when the
-- class ends, using the duration → units rule).
--
-- Impact: students who attended >50-min sessions in the past will see their
-- balance drop retroactively to reflect what they actually consumed. This
-- is a CORRECTION, not a regression. Run during low-traffic.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION recompute_classes_remaining(p_student_id uuid)
RETURNS void AS $$
BEGIN
    UPDATE students s
       SET classes_remaining = GREATEST(0,
              s.classes_purchased
              + s.classes_adjustment
              - COALESCE((
                  SELECT SUM(c.billed_hours)::int
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
                  SELECT SUM(c.billed_hours)::int
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

-- Update the reporting view too.
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
    SELECT SUM(c.billed_hours)::INT AS n
      FROM class_participants cp
      JOIN classes c ON c.id = cp.class_id
     WHERE cp.student_id = s.id
       AND cp.counts_as_session = TRUE
       AND c.status = 'completed'
       AND c.billed_hours > 0
) consumed ON TRUE;

-- Recompute classes_remaining for every student so the new formula
-- propagates immediately.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id FROM students LOOP
        PERFORM recompute_classes_remaining(r.id);
    END LOOP;
END $$;

COMMIT;
