-- Bono de cierre escalado por ritmo vendido (decisión Gelfis 2026-09-27).
-- El motor (web/lib/commission-engine.ts::resolveBonoCierreCents) lee
-- bono_cierre_<ritmo>_cents y cae a bono_cierre_cents si el ritmo no se
-- reconoce. Las conversiones de pago único (tipo_pago != 'suscripcion')
-- usan bono_cierre_pago_unico_cents.
BEGIN;

INSERT INTO config_comisiones (clave, valor, descripcion) VALUES
  ('bono_cierre_viajero_cents',     2500, 'Bono de cierre · ritmo Viajero (6 clases/mes)'),
  ('bono_cierre_estandar_cents',    3500, 'Bono de cierre · ritmo Estándar (8 clases/mes)'),
  ('bono_cierre_intensivo_cents',   5000, 'Bono de cierre · ritmo Intensivo (12 clases/mes)'),
  ('bono_cierre_vip_express_cents', 7500, 'Bono de cierre · ritmo VIP Express (16 clases/mes)'),
  ('bono_cierre_pago_unico_cents', 15000, 'Bono de cierre · pack de pago único')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, descripcion = EXCLUDED.descripcion;

UPDATE config_comisiones
   SET descripcion = 'Bono de cierre por defecto (fallback si el ritmo no se reconoce)'
 WHERE clave = 'bono_cierre_cents';

COMMIT;
