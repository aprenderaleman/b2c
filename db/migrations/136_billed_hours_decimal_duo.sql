-- Clases en dúo de 90 min (Gelfis 2026-10-12, Dúo Annette & Gastón con Simon):
--   · cada sesión descuenta 1 clase del pack de CADA alumno,
--   · el profe cobra 1,5 unidades (15 € × 1,5 = 22,50 €).
-- Dos ajustes por grupo: billing_units_per_session (lo que consume el alumno y
-- se escribe en classes.billed_hours) y teacher_units_per_session (lo que se
-- paga al profe). Sin cambios de tipo en columnas existentes.
BEGIN;

ALTER TABLE student_groups
  ADD COLUMN IF NOT EXISTS billing_units_per_session NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS teacher_units_per_session NUMERIC(4,2);
COMMENT ON COLUMN student_groups.billing_units_per_session IS 'Unidades que consume cada alumno por sesión completada del grupo (sustituye al cálculo por duración).';
COMMENT ON COLUMN student_groups.teacher_units_per_session IS 'Unidades que cobra el profe por sesión completada del grupo (p. ej. 1.5 para dúos de 90 min). Si es NULL, cobra billed_hours.';

CREATE OR REPLACE FUNCTION public.tg_classes_auto_log_hours()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    rate_cents int;
    is_individual boolean;
    log_amount_cents int;
    log_rate numeric;
    log_currency text;
    teacher_units numeric;
BEGIN
    IF NEW.status <> 'completed' OR COALESCE(NEW.billed_hours, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    IF COALESCE(NEW.is_trial, FALSE) = TRUE THEN
        SELECT t.rate_individual_cents INTO rate_cents
          FROM teachers t WHERE t.id = NEW.teacher_id;
        IF rate_cents IS NULL OR rate_cents = 0 THEN
            RETURN NEW;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM class_hours_log WHERE class_id = NEW.id) THEN
        RETURN NEW;
    END IF;

    is_individual := (NEW.type = 'individual');
    SELECT
        CASE WHEN is_individual THEN t.rate_individual_cents ELSE t.rate_group_cents END,
        t.currency
      INTO rate_cents, log_currency
      FROM teachers t
     WHERE t.id = NEW.teacher_id;

    IF rate_cents IS NULL OR rate_cents = 0 THEN
        RETURN NEW;
    END IF;

    -- Unidades que cobra el profe: las del grupo si están definidas
    -- (dúo 90 min = 1,5), si no, las mismas que consume el alumno.
    teacher_units := NEW.billed_hours;
    IF NEW.group_id IS NOT NULL THEN
        SELECT COALESCE(sg.teacher_units_per_session, NEW.billed_hours)
          INTO teacher_units
          FROM student_groups sg WHERE sg.id = NEW.group_id;
        teacher_units := COALESCE(teacher_units, NEW.billed_hours);
    END IF;

    log_amount_cents := ROUND(teacher_units * rate_cents);
    log_rate := rate_cents / 100.0;

    INSERT INTO class_hours_log
        (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
    VALUES
        (NEW.id, NEW.teacher_id, ROUND(teacher_units * 50), log_rate, log_amount_cents,
         COALESCE(log_currency, 'EUR'), COALESCE(NEW.scheduled_at, now()))
    ON CONFLICT (class_id) DO NOTHING;

    PERFORM recompute_teacher_month(NEW.teacher_id, NEW.scheduled_at);

    RETURN NEW;
END;
$function$;

-- Dúo Annette & Gastón (Simon): alumnos 1 clase/sesión, Simon 1,5.
UPDATE student_groups
   SET billing_units_per_session = 1, teacher_units_per_session = 1.5
 WHERE id = '8bf7646d-e2a2-4de6-9bb1-0206b0b64272';

COMMIT;
