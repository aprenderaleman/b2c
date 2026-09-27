-- Comisiones: enlazar cada comisión/bono con el alumno convertido para que
-- la factura del profe muestre "Comisión por conversión · Nathaly (09-09)"
-- (petición Gelfis 2026-09-27). Antes solo guardaba el id de pago Stripe.
BEGIN;

ALTER TABLE comisiones
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comisiones_student ON comisiones(student_id);

-- Backfill: el bono y la conversión comparten el id de pago (el bono lleva
-- prefijo bono_cierre_). Cruzamos con payments por payment_intent y, para
-- las sesiones de checkout (cs_…), por la conversión más cercana en el
-- tiempo (misma ventana de 10 minutos que usa el webhook).
UPDATE comisiones co
   SET student_id = p.student_id
  FROM payments p
 WHERE co.student_id IS NULL
   AND p.stripe_payment_intent_id IS NOT NULL
   AND regexp_replace(co.stripe_payment_intent_id, '^bono_cierre_', '') = p.stripe_payment_intent_id;

UPDATE comisiones co
   SET student_id = p.student_id
  FROM payments p
 WHERE co.student_id IS NULL
   AND regexp_replace(co.stripe_payment_intent_id, '^bono_cierre_', '') = 'manual_transfer_' || p.id::text;

UPDATE comisiones co
   SET student_id = (
     SELECT s.id
       FROM students s
      WHERE s.converted_at IS NOT NULL
        AND abs(extract(epoch from (s.converted_at - co.created_at))) < 600
      ORDER BY abs(extract(epoch from (s.converted_at - co.created_at)))
      LIMIT 1
   )
 WHERE co.student_id IS NULL
   AND co.tipo IN ('conversion', 'bono_cierre')
   AND regexp_replace(co.stripe_payment_intent_id, '^bono_cierre_', '') LIKE 'cs_%';

COMMIT;
