-- Migration 139 — leads.profe: añadir 'veronica' (campaña /clase-profe).
-- 'aracely' se conserva en el constraint: hay leads históricos con ese valor.

BEGIN;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_profe_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_profe_check
  CHECK (profe IS NULL OR profe IN ('sabine', 'jonathan', 'thomas', 'simon', 'aracely', 'veronica', 'generico'));

COMMIT;
