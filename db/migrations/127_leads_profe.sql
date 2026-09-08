-- =============================================================================
-- Migration 127 — leads.profe
-- =============================================================================
-- Campaña Meta Reels 2026-08-20: la landing /clase-profe redirige al
-- lead a través de /agendar/cuando con ?profe=sabine|jonathan. Guardamos
-- el slug capturado tal cual para que /admin/leads pueda filtrar por
-- rendimiento del reel de cada profesor, independiente de qué teacher
-- terminó dando la clase (por sustituciones futuras).
--
--   sabine   → el reel de Sabine fue el que trajo al lead
--   jonathan → idem con Jonathan
--   generico → landing sin param o con valor no reconocido
--
-- landing_intent ya lleva "clase-profe-{X}" pero es un campo genérico
-- de landing (mezcla con las otras landings). Este campo es el que se
-- usa para reporting focalizado de la campaña.
-- =============================================================================

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS profe TEXT
  CHECK (profe IS NULL OR profe IN ('sabine', 'jonathan', 'generico'));

CREATE INDEX IF NOT EXISTS leads_profe_idx
  ON leads(profe)
  WHERE profe IS NOT NULL;

COMMENT ON COLUMN leads.profe IS
  'Slug del reel/profe que originó el lead en la campaña /clase-profe. NULL para leads que NO vinieron de esa landing.';

COMMIT;
