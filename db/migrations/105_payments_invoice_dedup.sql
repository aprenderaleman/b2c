-- 105: Dedup de payments por invoice (caso Nancy 2026-08-05)
--
-- El pago de una suscripción genera 3 eventos Stripe (payment_intent.
-- succeeded + invoice.paid + invoice.payment_succeeded). El dedup
-- dependía de invoice.payment_intent, campo que las versiones nuevas
-- del API de Stripe ya no incluyen → un solo cobro de 320€ insertó
-- TRES filas en payments (revenue triple-contado).
--
-- Fix: columna stripe_invoice_id + índice único parcial. El webhook
-- la rellena y dedupea por ella.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_invoice_unique
  ON payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
