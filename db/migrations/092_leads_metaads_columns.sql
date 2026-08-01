-- Add Meta Ads Paid funnel columns to leads table.
-- These are referenced by listTrialClasses, book-trial-metaads-paid,
-- deposit-checkout webhook, and the admin CRM views.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS reserva_prioritaria  boolean DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority_deadline     text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_intent_at     timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS qualification_answers jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS landing_intent        text;
