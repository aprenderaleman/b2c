BEGIN;

-- Ampliar CHECK de tipo en comisiones para incluir los nuevos tipos
ALTER TABLE comisiones DROP CONSTRAINT comisiones_tipo_check;
ALTER TABLE comisiones ADD CONSTRAINT comisiones_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'comision_base','bono_rescate','comision_precalificacion',
    'conversion','bono_cierre'
  ]));

-- class_hours_log.class_id nullable: comisiones por Stripe no están ligadas a una clase
ALTER TABLE class_hours_log ALTER COLUMN class_id DROP NOT NULL;

-- Bono de cierre: 50€ fijo al primer pago de cada conversión
INSERT INTO config_comisiones (clave, valor, descripcion)
VALUES ('bono_cierre_cents', 5000, 'Bono fijo en centimos al confirmarse el primer pago de cada conversion')
ON CONFLICT DO NOTHING;

COMMIT;
