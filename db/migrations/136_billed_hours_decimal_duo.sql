-- Clases en dúo de 90 min que cuentan 1,5 clases (Gelfis 2026-10-12: Dúo
-- Annette & Gastón con Simon). billed_hours pasa a decimal y cada grupo
-- puede fijar cuántas unidades vale una sesión (billing_units_per_session);
-- el saldo del alumno acepta medias clases.
BEGIN;

-- Vistas legacy que dependen de las columnas: se recrean con sumas numéricas.
DROP VIEW IF EXISTS v_student_packs;
DROP VIEW IF EXISTS v_teacher_earnings;

ALTER TABLE classes  ALTER COLUMN billed_hours       TYPE NUMERIC(5,2) USING billed_hours::numeric;
ALTER TABLE students ALTER COLUMN classes_remaining  TYPE NUMERIC(6,2) USING classes_remaining::numeric;

CREATE VIEW v_student_packs AS
 SELECT s.id AS student_id, s.user_id, u.full_name, u.email, s.current_level, s.subscription_type,
        s.classes_purchased, s.classes_adjustment, s.pack_started_at, s.pack_expires_at,
        COALESCE(consumed.n, 0) AS classes_consumed,
        s.classes_purchased + s.classes_adjustment - COALESCE(consumed.n, 0) AS classes_remaining
   FROM students s
   JOIN users u ON u.id = s.user_id
   LEFT JOIN LATERAL (
     SELECT sum(c.billed_hours) AS n
       FROM class_participants cp JOIN classes c ON c.id = cp.class_id
      WHERE cp.student_id = s.id AND cp.counts_as_session = true AND c.status = 'completed' AND c.billed_hours > 0
   ) consumed ON true;

CREATE VIEW v_teacher_earnings AS
 SELECT t.id AS teacher_id, u.full_name, u.email,
        date_trunc('month', c.started_at)::date AS period_start,
        c.type AS class_type,
        count(*)::integer AS classes_count,
        sum(c.billed_hours) AS hours_total,
        sum(c.billed_hours * CASE c.type WHEN 'group' THEN t.rate_group_cents WHEN 'individual' THEN t.rate_individual_cents ELSE 0 END)::integer AS amount_cents
   FROM teachers t JOIN users u ON u.id = t.user_id JOIN classes c ON c.teacher_id = t.id
  WHERE c.status = 'completed' AND c.billed_hours > 0
  GROUP BY t.id, u.full_name, u.email, date_trunc('month', c.started_at), c.type;
ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS billing_units_per_session NUMERIC(4,2);
COMMENT ON COLUMN student_groups.billing_units_per_session IS 'Si está definido, cada clase completada del grupo factura/consume estas unidades (p. ej. 1.5 para dúos de 90 min) en vez de calcularlas por duración.';

-- recompute_classes_remaining sin el cast a entero (migración 128).
CREATE OR REPLACE FUNCTION recompute_classes_remaining(p_student_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  UPDATE students s
     SET classes_remaining = GREATEST(0,
            COALESCE(s.clases_totales, s.classes_purchased, 0)
            + COALESCE(s.classes_adjustment, 0)
            - COALESCE((
                SELECT SUM(c.billed_hours)
                  FROM class_participants cp
                  JOIN classes c ON c.id = cp.class_id
                 WHERE cp.student_id = s.id
                   AND cp.counts_as_session = TRUE
                   AND c.status = 'completed'
                   AND COALESCE(c.is_trial, false) = false
                   AND c.billed_hours > 0
              ), 0))
   WHERE s.id = p_student_id;
END $$;

COMMIT;
