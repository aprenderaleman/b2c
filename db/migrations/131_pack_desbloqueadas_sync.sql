-- =============================================================================
-- Migration 131 — clases_desbloqueadas de los PACKS siempre = contrato + ajuste
-- =============================================================================
-- Bug (Simon, 2026-09-21): Ahlam con 14 clases restantes salía con "0
-- agendables". getClassBalance calcula agendables = desbloqueadas −
-- consumidas − agendadas, y en los packs (pago único / planes viejos) todo
-- el contrato está desbloqueado desde el día 1, pero clases_desbloqueadas
-- no se tocaba al cambiar clases_totales o classes_adjustment.
--
-- Regla: si NO es suscripción mensual → desbloqueadas = clases_totales +
-- classes_adjustment (así desbloqueadas − consumidas = classes_remaining).
-- Las suscripciones siguen desbloqueando por cuota pagada (webhook).
-- =============================================================================

BEGIN;

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

    IF NEW.subscription_type IS DISTINCT FROM 'monthly_subscription'
       AND (TG_OP = 'UPDATE' OR COALESCE(NEW.clases_desbloqueadas, 0) = 0) THEN
        NEW.clases_desbloqueadas := GREATEST(0, COALESCE(NEW.clases_totales, 0) + COALESCE(NEW.classes_adjustment, 0));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_sync_totales ON students;
CREATE TRIGGER students_sync_totales
    BEFORE INSERT OR UPDATE OF clases_totales, classes_purchased, classes_adjustment, subscription_type ON students
    FOR EACH ROW EXECUTE FUNCTION tg_students_sync_totales();

-- Backfill de todos los packs
UPDATE students
   SET clases_desbloqueadas = GREATEST(0, COALESCE(clases_totales, 0) + COALESCE(classes_adjustment, 0))
 WHERE subscription_type IS DISTINCT FROM 'monthly_subscription';

COMMIT;
