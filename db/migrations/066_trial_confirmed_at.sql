-- Migration 066: leads.trial_confirmed_at
--
-- Persiste el momento exacto en que el lead respondio "CONFIRMO" (u
-- otra variante de confirmacion) al WA T+0 del trial. Permite:
--   - Estadisticas: cuantos confirman explicitamente vs no.
--   - Logica futura: skip "pedir confirmacion" en T-24h si ya confirmo.
--   - Auditoria del flow de presion psicologica del bloque CONFIRMO/
--     CAMBIAR/CANCELAR (Gelfis 2026-06-17).
--
-- Por que columna dedicada y no leads.meta: la columna `meta` referenciada
-- por web/lib/admin-actions.ts NO existe en produccion (bug pre-existente
-- 2026-06-17). Hasta arreglar eso, usar columna explicita.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS trial_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.trial_confirmed_at IS
  'Timestamp en que el lead respondio CONFIRMO (o variante) al WA de '
  'confirmacion del trial. Set por reschedule_flow._send_confirm_ack.';
