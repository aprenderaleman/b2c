-- =============================================================================
-- Migration 047 — auto-log de class_hours_log al cerrar una clase
-- =============================================================================
-- Decisión Gelfis 2026-05-06 tras detectar nómina mayo desfasada:
--   Cuando una clase pasa a status='completed' con billed_hours > 0,
--   debe poblarse class_hours_log automáticamente, sin depender de que
--   el endpoint /api/aula/[id]/end haya disparado lib/finance.ts.
--
-- Hasta ahora solo el endpoint del aula creaba la fila. Si la clase se
-- cerraba por otra vía (admin manual, cron close-stale-classes, script
-- one-off, importación), la nómina del profe quedaba incompleta y había
-- que parchear a mano cada mes.
--
-- El trigger:
--   1. Solo dispara cuando billed_hours pasa de 0/null a > 0 ó cuando
--      status pasa a 'completed' con billed_hours ya > 0.
--   2. Evita duplicados: ON CONFLICT (class_id) DO NOTHING — si el
--      endpoint del aula llegó primero, deja su fila intacta.
--   3. Calcula amount_cents y rate_at_time desde teachers.rate_*_cents
--      según c.type ('individual' vs 'group').
--   4. Llama recompute_teacher_month(teacher_id, scheduled_at) para
--      mantener teacher_earnings sincronizado.
--
-- Idempotente. Seguro de re-aplicar — si todo está al día no hace nada.
-- =============================================================================

BEGIN;

-- Helper: recomputa teacher_earnings(teacher, mes) sumando class_hours_log
-- del mes correspondiente. Usado por el trigger Y por scripts ad-hoc.
CREATE OR REPLACE FUNCTION recompute_teacher_month(
    p_teacher_id uuid,
    p_any_date_in_month timestamptz
) RETURNS void AS $$
DECLARE
    month_start date;
    month_end date;
BEGIN
    month_start := DATE_TRUNC('month', p_any_date_in_month)::date;
    month_end   := (month_start + INTERVAL '1 month')::date;

    INSERT INTO teacher_earnings (teacher_id, month, total_minutes, classes_count, amount_cents, currency)
    SELECT chl.teacher_id,
           month_start,
           COALESCE(SUM(chl.duration_minutes), 0)::int,
           COUNT(*)::int,
           COALESCE(SUM(chl.amount_cents), 0)::int,
           COALESCE(MAX(chl.currency), 'EUR')
      FROM class_hours_log chl
     WHERE chl.teacher_id = p_teacher_id
       AND chl.created_at >= month_start
       AND chl.created_at < month_end
     GROUP BY chl.teacher_id
    ON CONFLICT (teacher_id, month) DO UPDATE SET
        total_minutes = EXCLUDED.total_minutes,
        classes_count = EXCLUDED.classes_count,
        amount_cents  = EXCLUDED.amount_cents,
        currency      = EXCLUDED.currency,
        updated_at    = now();

    -- Si el mes acabó vacío (la única fila se borró, p.ej.) limpiamos
    -- el rollup en lugar de dejar 0/0/0.
    DELETE FROM teacher_earnings
     WHERE teacher_id = p_teacher_id
       AND month = month_start
       AND classes_count = 0;
END;
$$ LANGUAGE plpgsql;


-- Función del trigger en sí: insert + recompute.
CREATE OR REPLACE FUNCTION tg_classes_auto_log_hours() RETURNS trigger AS $$
DECLARE
    rate_cents int;
    is_individual boolean;
    log_amount_cents int;
    log_rate numeric;
    log_currency text;
BEGIN
    -- Solo nos interesan transiciones que dejen la fila lista para cobrar:
    --   (status='completed' AND billed_hours > 0)
    -- Y que NO sean trial classes (los trials de Stiv/Gelfis no se cobran
    -- al profe del trial — Gelfis es admin). Filtramos por role del user
    -- propietario del teacher: si no tiene fila en teachers, salir.
    IF NEW.status <> 'completed' OR COALESCE(NEW.billed_hours, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    -- Si es trial, NO facturamos al profe (los trials los lleva Stiv via
    -- una cuenta admin; los profes regulares NO dan trials en el flujo
    -- estándar pero por seguridad excluimos).
    IF COALESCE(NEW.is_trial, FALSE) = TRUE THEN
        -- Excepción: si el teacher_id apunta a un profe REAL (con
        -- rate_*_cents > 0), sí facturamos. Esto cubre el caso de un
        -- profe que dió un trial cubriendo a Gelfis.
        SELECT t.rate_individual_cents INTO rate_cents
          FROM teachers t WHERE t.id = NEW.teacher_id;
        IF rate_cents IS NULL OR rate_cents = 0 THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Skip si ya hay fila (idempotencia con el endpoint del aula que
    -- llegó primero).
    IF EXISTS (SELECT 1 FROM class_hours_log WHERE class_id = NEW.id) THEN
        RETURN NEW;
    END IF;

    -- Determinar la rate aplicable según class.type
    is_individual := (NEW.type = 'individual');
    SELECT
        CASE WHEN is_individual THEN t.rate_individual_cents ELSE t.rate_group_cents END,
        t.currency
      INTO rate_cents, log_currency
      FROM teachers t
     WHERE t.id = NEW.teacher_id;

    IF rate_cents IS NULL OR rate_cents = 0 THEN
        -- Profe sin rate configurada — no hay nada que facturar; el admin
        -- tendrá que setear la tarifa y volver a tocar el row para
        -- re-disparar este trigger.
        RETURN NEW;
    END IF;

    log_amount_cents := NEW.billed_hours * rate_cents;
    log_rate := rate_cents / 100.0;

    -- Insertar la fila (en duration_minutes guardamos billed * 50, que es
    -- la unidad académica universal de la decisión 2026-05-02).
    INSERT INTO class_hours_log
        (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
    VALUES
        (NEW.id, NEW.teacher_id, NEW.billed_hours * 50, log_rate, log_amount_cents,
         COALESCE(log_currency, 'EUR'), COALESCE(NEW.scheduled_at, now()))
    ON CONFLICT (class_id) DO NOTHING;

    -- Refrescar rollup mensual para que /admin/finanzas/profesores muestre
    -- el dato sin esperar al cron.
    PERFORM recompute_teacher_month(NEW.teacher_id, NEW.scheduled_at);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Wire the trigger. AFTER UPDATE para no bloquear el commit si el insert
-- falla (best-effort en términos de rendimiento; los errores se loggean).
DROP TRIGGER IF EXISTS classes_auto_log_hours ON classes;
CREATE TRIGGER classes_auto_log_hours
    AFTER UPDATE OF status, billed_hours ON classes
    FOR EACH ROW
    -- Solo disparar cuando una de las dos columnas cambió (evita ruido en
    -- updates de title/notes/etc.).
    WHEN (
        OLD.status IS DISTINCT FROM NEW.status
        OR OLD.billed_hours IS DISTINCT FROM NEW.billed_hours
    )
    EXECUTE FUNCTION tg_classes_auto_log_hours();

-- También para INSERTs: si una clase se crea ya como 'completed' con bh>0
-- (p.ej. backfill manual de clases pasadas), debe loggearse igualmente.
DROP TRIGGER IF EXISTS classes_auto_log_hours_insert ON classes;
CREATE TRIGGER classes_auto_log_hours_insert
    AFTER INSERT ON classes
    FOR EACH ROW
    WHEN (NEW.status = 'completed' AND COALESCE(NEW.billed_hours, 0) > 0)
    EXECUTE FUNCTION tg_classes_auto_log_hours();

COMMIT;
