-- ─────────────────────────────────────────────────────────────────────────
-- 167: Tarifas fijas por closer (Gelfis 2026-11-27, acuerdo con Iván).
-- Algunos closers pactan comisiones fijas en lugar del sistema de rangos:
--   closer_pct_unico        → % sobre el importe cobrado en pagos únicos
--   closer_pct_suscripcion  → % sobre la PRIMERA mensualidad cobrada
-- NULL en ambas = sigue el sistema de rangos (rookie/closer/elite/master).
-- El Acuerdo de Colaboración se genera con estas condiciones cuando
-- existen (sin mencionar rangos).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS closer_pct_unico NUMERIC(5,2)
    CHECK (closer_pct_unico IS NULL OR (closer_pct_unico >= 0 AND closer_pct_unico <= 100)),
  ADD COLUMN IF NOT EXISTS closer_pct_suscripcion NUMERIC(5,2)
    CHECK (closer_pct_suscripcion IS NULL OR (closer_pct_suscripcion >= 0 AND closer_pct_suscripcion <= 100));

COMMENT ON COLUMN users.closer_pct_unico IS
  'Comisión fija (%) del closer en ventas de pago único. NULL = por rango.';
COMMENT ON COLUMN users.closer_pct_suscripcion IS
  'Comisión fija (%) del closer sobre la primera mensualidad de una suscripción. NULL = por rango.';
