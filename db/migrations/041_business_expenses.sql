-- 041_business_expenses.sql
--
-- Operating expenses (ads, tools, infra, legal, other) as a counter-
-- weight to `payments` revenue + `teacher_earnings` payroll on the
-- /admin/finanzas dashboard. One row per expense, free-text
-- description, decimal amount stored in cents to dodge float drift.
--
-- The category enum is small on purpose — anything not covered falls
-- into 'other' with a descriptive note. Adding new categories is a
-- one-line ALTER TYPE … ADD VALUE.

DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM ('ads', 'tools', 'infra', 'legal', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS business_expenses (
  id            uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  category      expense_category   NOT NULL,
  amount_cents  integer            NOT NULL CHECK (amount_cents >= 0),
  currency      text               NOT NULL DEFAULT 'EUR',
  description   text,
  incurred_at   date               NOT NULL DEFAULT CURRENT_DATE,
  created_at    timestamptz        NOT NULL DEFAULT now(),
  created_by    uuid               REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS business_expenses_period
  ON business_expenses (incurred_at DESC);

CREATE INDEX IF NOT EXISTS business_expenses_category
  ON business_expenses (category, incurred_at DESC);

COMMENT ON TABLE business_expenses IS
  'Operating expenses to net against revenue on /admin/finanzas. Categories: ads, tools, infra, legal, other.';
