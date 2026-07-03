-- 079_lead_deposit_paid.sql
-- Gelfis 2026-06-30: denormaliza deposit_paid_at desde classes a leads
-- para que las queries del CRM /admin/funnel (filtro + badge) no
-- necesiten join. Source of truth sigue siendo classes.deposit_paid_at
-- (actualizado por el endpoint /api/public/mark-deposit-paid); esta
-- columna se mantiene en sync desde ese mismo endpoint.
--
-- Backfill: propaga desde la clase de prueba más reciente del lead.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ;

-- Backfill de los leads que ya pagaron antes de esta migración.
UPDATE leads l
SET deposit_paid_at = c.deposit_paid_at
FROM classes c
WHERE c.lead_id = l.id
  AND c.is_trial = true
  AND c.deposit_paid_at IS NOT NULL
  AND (l.deposit_paid_at IS NULL OR l.deposit_paid_at < c.deposit_paid_at);

-- Índice parcial para el filtro "solo con depósito" del CRM. Cardinalidad
-- baja esperada (leads con depósito « leads totales), sirve.
CREATE INDEX IF NOT EXISTS idx_leads_deposit_paid
  ON leads (deposit_paid_at DESC)
  WHERE deposit_paid_at IS NOT NULL;
