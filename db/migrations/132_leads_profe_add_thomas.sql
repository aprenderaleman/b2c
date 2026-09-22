-- =============================================================================
-- Migration 132 — leads.profe: añadir 'thomas'
-- =============================================================================
-- Campaña Meta Reels 2026-09-22: 3er profesor incorporado a la landing
-- /clase-profe. El constraint de la migración 127 sólo permitía
-- sabine/jonathan/generico; lo ampliamos a thomas.
-- =============================================================================

BEGIN;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_profe_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_profe_check
  CHECK (profe IS NULL OR profe IN ('sabine', 'jonathan', 'thomas', 'generico'));

COMMIT;
