-- =============================================================================
-- Migration 005 — teachers
-- =============================================================================
-- One row per teacher user. 1-to-1 with `users` (user_id is unique) and a
-- teacher's row is only created alongside a users row with role='teacher'.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS teachers (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL UNIQUE
                       REFERENCES users(id) ON DELETE CASCADE,
    bio                TEXT,
    languages_spoken   TEXT[] NOT NULL DEFAULT ARRAY['de']::TEXT[],
    specialties        TEXT[] NOT NULL DEFAULT '{}'::TEXT[],  -- e.g. ['A1','B2','TELC','Goethe']
    hourly_rate        NUMERIC(10, 2),                         -- nullable until set
    currency           TEXT NOT NULL DEFAULT 'EUR'
                       CHECK (currency IN ('EUR', 'USD', 'CHF')),
    payment_method     TEXT,                                   -- free text for bank details / PayPal / etc.
    notes              TEXT,                                   -- admin-only
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teachers_active_idx ON teachers(active) WHERE active = TRUE;

CREATE OR REPLACE FUNCTION tg_teachers_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teachers_updated_at ON teachers;
CREATE TRIGGER teachers_updated_at
    BEFORE UPDATE ON teachers
    FOR EACH ROW EXECUTE FUNCTION tg_teachers_updated_at();

COMMIT;
