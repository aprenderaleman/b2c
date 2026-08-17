-- =============================================================================
-- Migration 081 — auto-update classes_remaining al facturar una clase
-- =============================================================================
-- Problema: classes_remaining se desfasaba porque solo se actualizaba
-- manualmente o en scripts ad-hoc. Los estudiantes y profes veían datos
-- incorrectos y Gelfis tenía que auditar cada mes.
--
-- Solución: trigger en classes que recalcula classes_remaining de TODOS
-- los estudiantes participantes cada vez que billed_hours cambia.
--
-- Fórmula: remaining = purchased + adjustment - sum(billed_hours de todas
-- las clases del estudiante). Nunca baja de 0.
--
-- El trigger dispara en UPDATE de billed_hours y en INSERT con bh > 0.
-- Cubre clases de cualquier profesor (teacher, admin, superadmin).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION tg_classes_update_remaining() RETURNS trigger AS $$
DECLARE
    r record;
BEGIN
    -- Para cada estudiante participante de esta clase, recalcular remaining
    FOR r IN
        SELECT cp.student_id
          FROM class_participants cp
         WHERE cp.class_id = NEW.id
    LOOP
        UPDATE students
           SET classes_remaining = GREATEST(0,
                 COALESCE(classes_purchased, 0)
               + COALESCE(classes_adjustment, 0)
               - COALESCE((
                   SELECT SUM(c.billed_hours)
                     FROM classes c
                     JOIN class_participants cp2 ON cp2.class_id = c.id
                    WHERE cp2.student_id = r.student_id
                      AND c.billed_hours > 0
                 ), 0)
               )
         WHERE id = r.student_id;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- UPDATE: cuando billed_hours cambia
DROP TRIGGER IF EXISTS classes_update_remaining ON classes;
CREATE TRIGGER classes_update_remaining
    AFTER UPDATE OF billed_hours ON classes
    FOR EACH ROW
    WHEN (OLD.billed_hours IS DISTINCT FROM NEW.billed_hours)
    EXECUTE FUNCTION tg_classes_update_remaining();

-- INSERT: cuando se crea una clase ya con bh > 0
DROP TRIGGER IF EXISTS classes_update_remaining_insert ON classes;
CREATE TRIGGER classes_update_remaining_insert
    AFTER INSERT ON classes
    FOR EACH ROW
    WHEN (COALESCE(NEW.billed_hours, 0) > 0)
    EXECUTE FUNCTION tg_classes_update_remaining();

COMMIT;
