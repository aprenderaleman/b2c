BEGIN;

-- Make venta_id nullable (commissions can now come from Stripe, not just ventas)
ALTER TABLE comisiones ALTER COLUMN venta_id DROP NOT NULL;

-- Add Stripe-based commission columns
ALTER TABLE comisiones
    ADD COLUMN IF NOT EXISTS stripe_invoice_id          TEXT,
    ADD COLUMN IF NOT EXISTS stripe_payment_intent_id   TEXT,
    ADD COLUMN IF NOT EXISTS base_amount_cents           INT,
    ADD COLUMN IF NOT EXISTS comision_pct                NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS escenario                   TEXT NOT NULL DEFAULT 'E1',
    ADD COLUMN IF NOT EXISTS mes                         DATE,
    ADD COLUMN IF NOT EXISTS pagado                      BOOLEAN NOT NULL DEFAULT FALSE;

-- Idempotency: one commission per payment per beneficiary
CREATE UNIQUE INDEX IF NOT EXISTS comisiones_stripe_pi_usuario_uniq
    ON comisiones(stripe_payment_intent_id, usuario_id)
    WHERE stripe_payment_intent_id IS NOT NULL;

-- Link class_hours_log commission entries back to comisiones
ALTER TABLE class_hours_log
    ADD COLUMN IF NOT EXISTS comision_id UUID REFERENCES comisiones(id) ON DELETE SET NULL;

COMMIT;
