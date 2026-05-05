-- =============================================================================
-- Migration 046 — leads.reschedule_state
-- =============================================================================
-- Soporta el flujo multi-turno "cambio de hora del trial". Decisión Gelfis
-- 2026-05-04 tras incidente Asmaa (el bot respondía con plantilla
-- genérica en vez de procesar la solicitud real de reagendar).
--
-- Forma del JSONB:
--   {
--     "phase": "AWAITING_TIME" | "CONFIRMING" | "DONE",
--     "class_id": "uuid",                              -- la clase de prueba
--     "original_scheduled_at": "ISO8601",
--     "proposed_at": "ISO8601" | null,                  -- la hora que el lead pidió
--     "alternatives_offered": ["ISO8601", ...],         -- slots que el bot ya propuso
--     "rejected_count": 0,                              -- iteraciones; ≥3 → escalar
--     "started_at": "ISO8601",
--     "updated_at": "ISO8601"
--   }
--
-- Cuando phase = "DONE" o NULL, el flujo está inactivo.
-- =============================================================================

BEGIN;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS reschedule_state JSONB;

COMMENT ON COLUMN leads.reschedule_state IS
    'Multi-turn state for trial reschedule conversations. NULL when idle. See agents/reschedule_flow.py for state machine.';

-- Índice parcial: solo indexamos los leads con flujo activo (mucho más
-- pequeño que el total) para que el cron de timeout pueda escanear rápido.
CREATE INDEX IF NOT EXISTS leads_reschedule_state_active_idx
    ON leads ((reschedule_state->>'phase'))
 WHERE reschedule_state IS NOT NULL
   AND reschedule_state->>'phase' <> 'DONE';

COMMIT;
