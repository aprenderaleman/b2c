-- ============================================================
-- 102: Simplificación CRM closer — 5 estados derivados
--
-- Decisión Gelfis 2026-08-03: eliminar el pipeline manual del
-- closer. estado_cierre pasa de 6 valores a 5, y NUNCA se edita
-- a mano — solo lo mueven acciones registradas:
--
--   activo              → default al asignar closer
--   seguimiento_pactado → acción 📅 "seguimiento_fecha"
--   convertido          → aprobación de venta (post-pago Stripe)
--   en_reactivacion     → acción 🌙 "pasar_reactivacion"
--   perdido             → registro resultado no_interesado + motivo
--
-- 'sin_asignar' sobrevive solo como default pre-asignación
-- (leads sin closer; invisibles en el CRM del closer).
--
-- Los matices eliminados (venta_pendiente, en_seguimiento) no se
-- pierden: viven en la tabla `ventas` (estado=pendiente) y en el
-- timeline/acciones_closer.
-- ============================================================

BEGIN;

-- 1. Mapear datos existentes
UPDATE leads SET estado_cierre = 'activo'
WHERE estado_cierre IN ('en_seguimiento', 'venta_pendiente');

-- Residuo legacy: leads con closer asignado pero estado 'sin_asignar'
UPDATE leads SET estado_cierre = 'activo'
WHERE closer_id IS NOT NULL AND estado_cierre = 'sin_asignar';

-- (convertido, perdido, en_reactivacion, sin_asignar se quedan igual)

-- 2. Constraint para que no vuelvan a aparecer estados zombis
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_estado_cierre_check;
ALTER TABLE leads ADD CONSTRAINT leads_estado_cierre_check
  CHECK (estado_cierre IN (
    'sin_asignar',
    'activo',
    'seguimiento_pactado',
    'convertido',
    'en_reactivacion',
    'perdido'
  ));

COMMIT;
