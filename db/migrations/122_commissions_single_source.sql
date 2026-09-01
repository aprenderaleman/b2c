-- Consolidate commissions: comisiones table is the single source of truth.
-- recompute_teacher_month now reads commissions from comisiones, not CHL.
-- CHL kind='commission' entries are no longer created or read.

BEGIN;

CREATE OR REPLACE FUNCTION recompute_teacher_month(
    p_teacher_id uuid,
    p_any_date_in_month timestamptz
) RETURNS void AS $$
DECLARE
    month_start date;
    month_end   date;
    v_user_id   uuid;
    v_class_minutes  int;
    v_class_count    int;
    v_class_cents    int;
    v_commission_cents int;
BEGIN
    month_start := DATE_TRUNC('month', p_any_date_in_month)::date;
    month_end   := (month_start + INTERVAL '1 month')::date;

    SELECT user_id INTO v_user_id FROM teachers WHERE id = p_teacher_id;

    -- Classes from CHL (kind='class' only)
    SELECT COALESCE(SUM(chl.duration_minutes), 0)::int,
           COUNT(*)::int,
           COALESCE(SUM(chl.amount_cents), 0)::int
      INTO v_class_minutes, v_class_count, v_class_cents
      FROM class_hours_log chl
     WHERE chl.teacher_id = p_teacher_id
       AND chl.created_at >= month_start
       AND chl.created_at < month_end
       AND chl.kind = 'class';

    -- Commissions from comisiones table (single source of truth)
    SELECT COALESCE(SUM(co.monto_cents), 0)::int
      INTO v_commission_cents
      FROM comisiones co
     WHERE co.usuario_id = v_user_id
       AND co.mes = month_start;

    IF v_class_count > 0 OR v_commission_cents > 0 THEN
        INSERT INTO teacher_earnings (teacher_id, month, total_minutes, classes_count, amount_cents, currency)
        VALUES (p_teacher_id, month_start, v_class_minutes, v_class_count,
                v_class_cents + v_commission_cents, 'EUR')
        ON CONFLICT (teacher_id, month) DO UPDATE SET
            total_minutes = EXCLUDED.total_minutes,
            classes_count = EXCLUDED.classes_count,
            amount_cents  = EXCLUDED.amount_cents,
            currency      = EXCLUDED.currency,
            updated_at    = now();
    ELSE
        DELETE FROM teacher_earnings
         WHERE teacher_id = p_teacher_id
           AND month = month_start;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;
