-- =============================================================================
-- Migration 048 — outbound_queue: dedup por (phone+body) en filas queued
-- =============================================================================
-- Caso real Gelfis 2026-05-10: la queue creció a 456k filas en 7 días
-- por un loop. El productor seguía enqueueando el mismo (phone, body)
-- una y otra vez aunque el error era permanente (`"exists":false`).
--
-- Defensa: índice único parcial sobre (phone_e164, body) cuando
-- status='queued'. A partir de ahora, intentar insertar una fila
-- duplicada (misma combinación de teléfono+cuerpo en estado queued)
-- falla. El código en agents/shared/outbound_queue.py usa
-- ON CONFLICT DO NOTHING para tragarse el error sin loguear ruido.
--
-- No afecta a `failed_permanent` o `sent` — ahí sí puede haber muchas
-- filas con el mismo (phone, body) sin problema. Solo `queued` queda
-- limitado a UNA fila activa por combinación.
-- =============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS outbound_queue_active_unique_idx
    ON outbound_queue (phone_e164, body)
 WHERE status = 'queued';

COMMENT ON INDEX outbound_queue_active_unique_idx IS
    'Solo permite UNA fila queued por (phone+body). Defensa contra loops del productor (incidente 2026-05-10).';

COMMIT;
