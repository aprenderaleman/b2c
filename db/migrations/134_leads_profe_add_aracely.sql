-- Migration 134 — leads.profe: añadir 'aracely' (5ª profe de la campaña /clase-profe)

BEGIN;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_profe_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_profe_check
  CHECK (profe IS NULL OR profe IN ('sabine', 'jonathan', 'thomas', 'simon', 'aracely', 'generico'));

COMMIT;
