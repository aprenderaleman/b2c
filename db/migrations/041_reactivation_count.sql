-- =============================================================================
-- Migration 041 — leads.reactivation_count
-- =============================================================================
-- Tras la migración 023 ya teníamos current_followup_number para la cadena
-- inicial new → contacted_1..4 → cold. Pero estados POST-engagement
-- (link_sent, in_conversation) no eran cubiertos por nadie:
--
--   * Agent 0 los recogía via _leads_due (no estaban en PAUSED_STATUSES) PERO
--     compose_message devolvía None → el lead quedaba colgado para siempre.
--   * schedule_next_contact tampoco contemplaba esos estados → el campo
--     next_contact_date se quedaba en NULL tras una respuesta de Agent 4.
--
-- Esta columna cuenta cuántas veces el bot ha enviado una reactivación
-- mientras el lead estuvo en uno de esos estados. Política acordada con
-- Gelfis (2026-04-29):
--   link_sent       → max 2 reactivaciones (separadas por +24h y +5d) → cold
--   in_conversation → max 1 reactivación (+24h tras silencio)         → cold
--
-- Se reinicia a 0 cada vez que el lead vuelve a escribir (Agent 4 lo
-- considera "engaged" otra vez).
-- =============================================================================

BEGIN;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS reactivation_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN leads.reactivation_count IS
  'Cuántas veces hemos reactivado al lead durante un estado post-engagement '
  '(link_sent, in_conversation). Se reinicia a 0 cuando el lead vuelve a '
  'escribir. Política: link_sent → max 2, in_conversation → max 1.';

COMMIT;
