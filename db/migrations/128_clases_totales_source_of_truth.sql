-- =============================================================================
-- Migration 128 — clases_totales como contrato único + recálculo automático
-- =============================================================================
-- Problema (auditoría 2026-09-21):
--   * classes_remaining se recalcula por trigger como
--       classes_purchased + classes_adjustment − Σ billed_hours (completadas)
--     pero clases_totales (lo que se muestra al alumno, al profe y al admin,
--     y lo que fija la conversión) NO participa. Un alumno con purchased=96
--     y totales=32 volvía a 92 restantes en cuanto completaba una clase.
--   * Había tres funciones de recálculo con fórmulas distintas (025/044
--     estricta: solo completadas; 081 laxa: cualquier billed_hours > 0).
--
-- Solución:
--   1. Trigger BEFORE en students que mantiene clases_totales ⇔ classes_purchased
--      siempre iguales (cambies el que cambies). Todo lo existente sigue
--      funcionando y clases_totales pasa a ser el contrato.
--   2. Una sola fórmula (la estricta) en recompute_classes_remaining; las
--      demás funciones delegan en ella. Se excluyen trials explícitamente.
--   3. Backfill que preserva los saldos vigentes: para cada alumno,
--      classes_adjustment := classes_remaining − (clases_totales − consumidas),
--      de modo que el recálculo automático devuelve exactamente el saldo actual.
--      Para los planes nuevos el ajuste queda en 0; para los packs viejos
--      (unidades de 50 min, grupales que no cuentan, PDFs) absorbe la diferencia.
-- =============================================================================

BEGIN;

-- ── 1. Sync clases_totales ⇔ classes_purchased ───────────────────────────────

CREATE OR REPLACE FUNCTION tg_students_sync_totales() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.clases_totales IS NULL THEN
            NEW.clases_totales := NEW.classes_purchased;
        ELSE
            NEW.classes_purchased := NEW.clases_totales;
        END IF;
    ELSE
        IF NEW.clases_totales IS DISTINCT FROM OLD.clases_totales THEN
            NEW.classes_purchased := COALESCE(NEW.clases_totales, NEW.classes_purchased);
        ELSIF NEW.classes_purchased IS DISTINCT FROM OLD.classes_purchased THEN
            NEW.clases_totales := NEW.classes_purchased;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_sync_totales ON students;
CREATE TRIGGER students_sync_totales
    BEFORE INSERT OR UPDATE OF clases_totales, classes_purchased ON students
    FOR EACH ROW EXECUTE FUNCTION tg_students_sync_totales();

-- ── 2. Una sola fórmula ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recompute_classes_remaining(p_student_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
    UPDATE students s
       SET classes_remaining = GREATEST(0,
              COALESCE(s.clases_totales, s.classes_purchased, 0)
              + COALESCE(s.classes_adjustment, 0)
              - COALESCE((
                  SELECT SUM(c.billed_hours)::int
                    FROM class_participants cp
                    JOIN classes c ON c.id = cp.class_id
                   WHERE cp.student_id = s.id
                     AND cp.counts_as_session = TRUE
                     AND c.status = 'completed'
                     AND COALESCE(c.is_trial, FALSE) = FALSE
                     AND c.billed_hours > 0
              ), 0))
     WHERE s.id = p_student_id;
END;
$$;

-- classes: UPDATE de status/billed_hours (025) e INSERT ya completada (081) → delegan
CREATE OR REPLACE FUNCTION tg_classes_sync_remaining() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.billed_hours IS NOT DISTINCT FROM OLD.billed_hours THEN
        RETURN NEW;
    END IF;
    FOR r IN SELECT student_id FROM class_participants WHERE class_id = NEW.id LOOP
        PERFORM recompute_classes_remaining(r.student_id);
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tg_classes_update_remaining() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
    FOR r IN SELECT student_id FROM class_participants WHERE class_id = NEW.id LOOP
        PERFORM recompute_classes_remaining(r.student_id);
    END LOOP;
    RETURN NEW;
END;
$$;

-- students: recalcular al cambiar el contrato o el ajuste (también en INSERT)
CREATE OR REPLACE FUNCTION tg_students_adjustment_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
    IF TG_OP = 'INSERT'
       OR NEW.classes_adjustment IS DISTINCT FROM OLD.classes_adjustment
       OR NEW.classes_purchased  IS DISTINCT FROM OLD.classes_purchased
       OR NEW.clases_totales     IS DISTINCT FROM OLD.clases_totales THEN
        PERFORM recompute_classes_remaining(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_adjustment_sync ON students;
CREATE TRIGGER students_adjustment_sync
    AFTER INSERT OR UPDATE OF classes_adjustment, classes_purchased, clases_totales ON students
    FOR EACH ROW EXECUTE FUNCTION tg_students_adjustment_sync();

-- ── 3. Backfill preservando los saldos vigentes ──────────────────────────────

-- a) contrato: quien no lo tenía, hereda classes_purchased
UPDATE students SET clases_totales = classes_purchased WHERE clases_totales IS NULL;

-- b) ajuste := saldo actual − (contrato − consumidas); purchased := contrato
--    (los SET usan los valores previos de la fila; el AFTER trigger recalcula
--     y devuelve exactamente classes_remaining actual)
WITH consumed AS (
    SELECT cp.student_id, SUM(c.billed_hours)::int AS n
      FROM class_participants cp
      JOIN classes c ON c.id = cp.class_id
     WHERE cp.counts_as_session = TRUE
       AND c.status = 'completed'
       AND COALESCE(c.is_trial, FALSE) = FALSE
       AND c.billed_hours > 0
     GROUP BY cp.student_id
)
UPDATE students s
   SET classes_adjustment = s.classes_remaining - (s.clases_totales - COALESCE(k.n, 0)),
       classes_purchased  = s.clases_totales
  FROM (SELECT id FROM students) ids
  LEFT JOIN consumed k ON k.student_id = ids.id
 WHERE s.id = ids.id;

-- c) recálculo explícito de todos (por si algún trigger no disparó)
SELECT recompute_classes_remaining(id) FROM students;

COMMIT;
