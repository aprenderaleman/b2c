BEGIN;

-- Dedup table for Stripe webhook events
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id      text        PRIMARY KEY,
  event_type    text        NOT NULL,
  account_tag   text        NOT NULL CHECK (account_tag IN ('us', 'de')),
  processed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON stripe_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enrich payments with Stripe metadata + multi-currency support
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_account        text,
  ADD COLUMN IF NOT EXISTS original_currency     text,
  ADD COLUMN IF NOT EXISTS original_amount_cents integer,
  ADD COLUMN IF NOT EXISTS exchange_rate         numeric(12,6),
  ADD COLUMN IF NOT EXISTS stripe_charge_id      text;

CREATE INDEX IF NOT EXISTS payments_stripe_charge_idx
  ON payments (stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;

COMMIT;
