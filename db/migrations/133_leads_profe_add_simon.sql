-- Migration 133 — leads.profe: añadir 'simon' (4º profe de la campaña /clase-profe)

BEGIN;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_profe_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_profe_check
  CHECK (profe IS NULL OR profe IN ('sabine', 'jonathan', 'thomas', 'simon', 'generico'));

COMMIT;
