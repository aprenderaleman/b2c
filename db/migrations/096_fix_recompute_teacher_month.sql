BEGIN;

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
           COALESCE(SUM(chl.duration_minutes) FILTER (WHERE chl.kind = 'class'), 0)::int,
           COUNT(*) FILTER (WHERE chl.kind = 'class')::int,
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

    DELETE FROM teacher_earnings
     WHERE teacher_id = p_teacher_id
       AND month = month_start
       AND classes_count = 0
       AND amount_cents  = 0;
END;
$$ LANGUAGE plpgsql;

-- Set all teachers to 'starter' rank by default
UPDATE users SET rango = 'starter' WHERE role = 'teacher' AND rango IS NULL;

COMMIT;
