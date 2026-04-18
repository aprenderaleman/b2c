-- =============================================================================
-- Migration 016 — finance (without Stripe yet)
-- =============================================================================
-- Three tables, all populated manually by the admin for now. When Stripe
-- integration lands in a future phase, the same tables get written via
-- webhooks — the schema already has space for stripe identifiers.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE payment_type AS ENUM (
        'single_class',
        'package',
        'subscription_payment',
        'other'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- payments
--   Manual entries today, Stripe-driven later. Amounts in integer cents.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id                uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,

    amount_cents              INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency                  TEXT NOT NULL DEFAULT 'EUR'
                              CHECK (currency IN ('EUR', 'USD', 'CHF')),

    type                      payment_type NOT NULL,
    status                    payment_status NOT NULL DEFAULT 'paid',

    -- For 'package' / 'single_class' manual entries: how many classes this
    -- payment credits onto students.classes_remaining.
    classes_added             INTEGER NOT NULL DEFAULT 0,

    -- External identifiers (filled by Stripe webhooks in Phase 5 proper)
    stripe_payment_intent_id  TEXT UNIQUE,
    invoice_url               TEXT,

    note                      TEXT,                   -- free-form admin note
    paid_at                   TIMESTAMPTZ,             -- null until status='paid'
    created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_student_idx ON payments(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx  ON payments(status);


-- ---------------------------------------------------------------------------
-- class_hours_log
--   One row per completed class (teacher × class). Written automatically
--   when the teacher confirms the actual duration in /aula/[id]/end.
--   `rate_at_time` is snapshotted so a later teacher rate change doesn't
--   rewrite history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_hours_log (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id          uuid NOT NULL UNIQUE REFERENCES classes(id) ON DELETE CASCADE,
    teacher_id        uuid NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,

    duration_minutes  INTEGER NOT NULL CHECK (duration_minutes > 0),
    rate_at_time      NUMERIC(10, 2) NOT NULL,  -- EUR/hour snapshot
    amount_cents      INTEGER NOT NULL,          -- rate × duration/60 × 100
    currency          TEXT NOT NULL DEFAULT 'EUR',

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_hours_log_teacher_idx ON class_hours_log(teacher_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- teacher_earnings
--   Monthly rollup. One row per (teacher, month). Admin marks as paid
--   after the bank transfer. Recomputed every time a class_hours_log is
--   inserted for that month via a Supabase function or the application
--   layer (we do it in application code to keep things transparent).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_earnings (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id         uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    -- First day of the month (UTC), e.g. '2026-04-01'
    month              DATE NOT NULL,

    total_minutes      INTEGER NOT NULL DEFAULT 0,
    classes_count      INTEGER NOT NULL DEFAULT 0,
    amount_cents       INTEGER NOT NULL DEFAULT 0,
    currency           TEXT NOT NULL DEFAULT 'EUR',

    paid               BOOLEAN NOT NULL DEFAULT FALSE,
    paid_at            TIMESTAMPTZ,
    payment_reference  TEXT,                                 -- bank txn id, note, etc.

    locked             BOOLEAN NOT NULL DEFAULT FALSE,        -- true when month rolls over
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (teacher_id, month)
);

CREATE INDEX IF NOT EXISTS teacher_earnings_unpaid_idx
    ON teacher_earnings(month DESC) WHERE paid = FALSE;

CREATE OR REPLACE FUNCTION tg_teacher_earnings_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teacher_earnings_updated_at ON teacher_earnings;
CREATE TRIGGER teacher_earnings_updated_at
    BEFORE UPDATE ON teacher_earnings
    FOR EACH ROW EXECUTE FUNCTION tg_teacher_earnings_updated_at();


-- ---------------------------------------------------------------------------
-- RLS — service_role only (our API is the only client for now)
-- ---------------------------------------------------------------------------
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_hours_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_earnings  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['payments','class_hours_log','teacher_earnings']) LOOP
        EXECUTE format($f$
            DROP POLICY IF EXISTS "service_role_all_%I" ON %I;
            CREATE POLICY "service_role_all_%I" ON %I
                FOR ALL
                USING (auth.role() = 'service_role')
                WITH CHECK (auth.role() = 'service_role');
        $f$, tbl, tbl, tbl, tbl);
    END LOOP;
END $$;

COMMIT;
