-- Reserva Prioritaria (depósito 10€ opcional post-agenda) — 2026-07-24.
--
-- Flag + timestamps + backup fbclid en `leads`. Se marca cuando el webhook
-- Stripe recibe checkout.session.completed con metadata.type='trial_deposit'.
--
-- Los 10€ se descuentan del pack cuando el lead convierta a estudiante
-- (esa contabilidad vive en el módulo de pagos, no aquí).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reserva_prioritaria BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reserva_prioritaria_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reserva_prioritaria_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS fbclid TEXT;

-- Index para queries "leads con prioridad en los últimos N días" que
-- vamos a usar en /admin/funnel para medir attach-rate.
CREATE INDEX IF NOT EXISTS idx_leads_reserva_prioritaria_paid_at
  ON leads(reserva_prioritaria_paid_at DESC NULLS LAST)
  WHERE reserva_prioritaria = true;
