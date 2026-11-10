-- Migration 156: leads.profe acepta 'sina' (landing /clase-profe?profe=sina,
-- campaña Meta Reels CH, Gelfis 2026-11-10).
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_profe_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_profe_check
  CHECK (profe IS NULL OR profe IN ('sabine', 'jonathan', 'thomas', 'simon', 'aracely', 'veronica', 'sina', 'generico'));
