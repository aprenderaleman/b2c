-- =============================================================================
-- Migration 006 — students + student_progress
-- =============================================================================
-- Student = a lead that has paid / been promoted by Gelfis. The original
-- `leads` row stays untouched (status goes to 'converted' by existing logic
-- in /api/admin/leads/[id]/convert); we add a strong link both ways.
--
-- Stripe fields are nullable because Phase 1 is Stripe-less (Gelfis confirms
-- payments manually). They will be populated in Phase 5.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE cefr_level AS ENUM ('A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE subscription_type AS ENUM (
        'single_classes',        -- pay-per-class
        'package',               -- fixed bundle (e.g. 20 classes for 400€)
        'monthly_subscription',  -- recurring with N classes per month
        'combined'               -- package + extra single classes layered on top
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE skill_type AS ENUM (
        'speaking', 'writing', 'reading', 'listening', 'grammar', 'vocabulary'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  uuid NOT NULL UNIQUE
                             REFERENCES users(id) ON DELETE CASCADE,
    lead_id                  uuid UNIQUE
                             REFERENCES leads(id) ON DELETE SET NULL,

    -- Level / goal copied from the lead at conversion, editable afterwards
    current_level            cefr_level NOT NULL DEFAULT 'A0',
    goal                     TEXT,

    -- Subscription shape
    subscription_type        subscription_type NOT NULL,
    subscription_status      subscription_status NOT NULL DEFAULT 'active',
    classes_remaining        INTEGER NOT NULL DEFAULT 0,      -- bank of classes for packages
    classes_per_month        INTEGER,                         -- for monthly subscriptions
    monthly_price_cents      INTEGER,                         -- stored in cents, nullable
    currency                 TEXT NOT NULL DEFAULT 'EUR'
                             CHECK (currency IN ('EUR', 'USD', 'CHF')),

    -- Stripe (populated in Phase 5; manual confirmations in Phase 1)
    stripe_customer_id       TEXT UNIQUE,
    stripe_subscription_id   TEXT UNIQUE,

    -- External tool access
    schule_access            BOOLEAN NOT NULL DEFAULT TRUE,
    hans_access              BOOLEAN NOT NULL DEFAULT TRUE,

    -- Admin-only free text
    notes                    TEXT,

    converted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS students_subscription_status_idx
    ON students(subscription_status);
CREATE INDEX IF NOT EXISTS students_level_idx ON students(current_level);
CREATE INDEX IF NOT EXISTS students_lead_idx  ON students(lead_id);

CREATE OR REPLACE FUNCTION tg_students_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_updated_at ON students;
CREATE TRIGGER students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION tg_students_updated_at();


-- ---------------------------------------------------------------------------
-- student_progress
--    One row per (student, skill). Teachers update these after class.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_progress (
    student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    skill         skill_type NOT NULL,
    level_score   INTEGER NOT NULL DEFAULT 0
                  CHECK (level_score BETWEEN 0 AND 100),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (student_id, skill)
);

CREATE OR REPLACE FUNCTION tg_student_progress_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS student_progress_updated_at ON student_progress;
CREATE TRIGGER student_progress_updated_at
    BEFORE UPDATE ON student_progress
    FOR EACH ROW EXECUTE FUNCTION tg_student_progress_updated_at();

COMMIT;
