-- Meta Ads paid funnel (2026-07-28) — nuevo A/B parallel a /meta-ads.
--
-- El lead pasa por 5 pasos de calificación antes del calendario.
-- Persistimos las respuestas + un flag "inició paid sin depósito"
-- para que el CRM pueda segmentar y priorizar.
--
-- Nota: `reserva_prioritaria*` viene de migration 086. Aquí solo
-- añadimos lo específico del funnel de calificación.

ALTER TABLE leads
  -- 5 respuestas del wizard { goal, level, deadline, pain, notes }
  ADD COLUMN IF NOT EXISTS qualification_answers JSONB,
  -- Marcado cuando el lead completó el book-trial-metaads-paid y
  -- entró al flow de Stripe (haya pagado o no). Sirve para segmentar
  -- "inició paid sin depósito" en el CRM.
  ADD COLUMN IF NOT EXISTS deposit_intent_at TIMESTAMPTZ,
  -- Deadline categórico (paso 3 del wizard): concrete | 6m | year | no_rush.
  -- Cuando es 'concrete' el CRM lo destaca con 🔥.
  ADD COLUMN IF NOT EXISTS priority_deadline TEXT;

-- Índice para las queries "leads con depósito iniciado pero no pagado"
-- (candidatos a follow-up soft con link de pago).
CREATE INDEX IF NOT EXISTS idx_leads_deposit_intent_no_pay
  ON leads(deposit_intent_at DESC)
  WHERE deposit_intent_at IS NOT NULL AND reserva_prioritaria = false;

-- Índice para "leads urgentes" (fecha concreta 🔥).
CREATE INDEX IF NOT EXISTS idx_leads_priority_deadline
  ON leads(priority_deadline)
  WHERE priority_deadline = 'concrete';
