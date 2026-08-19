-- =============================================================================
-- Migration 118 — Fix defaults + add INSERT trigger for auto-billing
-- =============================================================================
-- Fixes 4 systemic gaps found in the Aug 2026 audit:
--
-- 1. student_groups.class_type DEFAULT was 'group' → now 'individual'
--    (policy: "ya no tendremos grupos, solo individuales")
--
-- 2. Auto-bill trigger (106) only fired on UPDATE OF status.
--    Classes INSERTed directly as 'completed' bypassed billing entirely.
--    Now also fires on INSERT.
--
-- 3. Fix existing data: Alexandra + Ángela groups → individual
--
-- 4. Fix existing data: Veronica's unbilled Ayman class (2026-07-29)
-- =============================================================================

BEGIN;

-- 1. Change DEFAULT from 'group' to 'individual'
ALTER TABLE student_groups
  ALTER COLUMN class_type SET DEFAULT 'individual';

-- 2. Add BEFORE INSERT trigger for auto-billing
--    Reuses the same function tg_auto_bill_on_complete() from migration 106
DROP TRIGGER IF EXISTS auto_bill_on_insert_complete ON classes;
CREATE TRIGGER auto_bill_on_insert_complete
    BEFORE INSERT ON classes
    FOR EACH ROW
    WHEN (NEW.status = 'completed')
    EXECUTE FUNCTION tg_auto_bill_on_complete();

-- 3. Fix Alexandra's group: class_type → individual, level → C1
UPDATE student_groups
   SET class_type = 'individual',
       level = 'C1'
 WHERE name ILIKE '%Alexandra%'
   AND class_type = 'group'
   AND active = true;

-- 4. Fix Ángela's group: class_type → individual
UPDATE student_groups
   SET class_type = 'individual'
 WHERE name ILIKE '%ngela%Clase individual%'
   AND class_type = 'group'
   AND active = true;

-- 5. Fix Alexandra's student record: clases_totales = 60
UPDATE students
   SET clases_totales = 60
 WHERE id = (
   SELECT s.id FROM students s
   JOIN users u ON u.id = s.user_id
   WHERE u.full_name ILIKE '%Alexandra Paulino%'
   LIMIT 1
 )
   AND clases_totales IS NULL;

-- 6. Fix Veronica's unbilled Ayman class (2026-07-29 16:00)
--    50min completed with room+recording, billed_hours was 0
--    The UPDATE will fire tg_classes_auto_log_hours (trigger 047)
--    which inserts into class_hours_log and recomputes teacher_earnings
UPDATE classes
   SET billed_hours = 1,
       actual_duration_minutes = COALESCE(actual_duration_minutes, 50)
 WHERE id = (
   SELECT cl.id FROM classes cl
   JOIN teachers t ON t.id = cl.teacher_id
   JOIN users tu ON tu.id = t.user_id
   JOIN class_participants cp ON cp.class_id = cl.id
   JOIN students s ON s.id = cp.student_id
   JOIN users su ON su.id = s.user_id
   WHERE tu.full_name ILIKE '%Veronica%'
     AND su.full_name ILIKE '%Ayman%'
     AND cl.status = 'completed'
     AND cl.scheduled_at >= '2026-07-29'
     AND cl.scheduled_at < '2026-07-30'
     AND COALESCE(cl.billed_hours, 0) = 0
   LIMIT 1
 );

COMMIT;
