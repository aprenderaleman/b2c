-- 144: el auto-billing al completar respeta billing_units_per_session del
-- grupo (dúo de 90 min = 1 sesión por alumno, no 2). Caso Annette & Gastón
-- 2026-10-15: el trigger puso billed_hours=2 y descontó 2 a cada uno.
CREATE OR REPLACE FUNCTION public.tg_auto_bill_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    dur int;
    units numeric;
    group_units numeric;
BEGIN
    IF NEW.status <> 'completed' THEN
        RETURN NEW;
    END IF;
    IF COALESCE(NEW.billed_hours, 0) > 0 THEN
        RETURN NEW;
    END IF;
    IF COALESCE(NEW.is_trial, FALSE) = TRUE THEN
        RETURN NEW;
    END IF;

    dur := COALESCE(NEW.actual_duration_minutes, NEW.duration_minutes);
    IF dur IS NULL OR dur < 15 THEN
        RETURN NEW;
    END IF;

    -- Grupo con unidades fijas por sesión (dúo/trío): manda el grupo.
    IF NEW.group_id IS NOT NULL THEN
        SELECT g.billing_units_per_session INTO group_units
          FROM student_groups g WHERE g.id = NEW.group_id;
        IF group_units IS NOT NULL AND group_units > 0 THEN
            NEW.billed_hours := group_units;
            RETURN NEW;
        END IF;
    END IF;

    IF dur <= 75 THEN
        units := 1;
    ELSIF dur <= 125 THEN
        units := 2;
    ELSIF dur <= 175 THEN
        units := 3;
    ELSE
        units := CEIL(dur::numeric / 50);
    END IF;

    NEW.billed_hours := units;
    RETURN NEW;
END;
$function$;
