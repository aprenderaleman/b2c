-- =============================================================================
-- Migration 004 — users & roles (Phase 1 foundation of the LMS)
-- =============================================================================
-- Creates the canonical `users` table that every authenticated role in the
-- system points to (admin / superadmin / teacher / student). Up until now
-- authentication only supported a single admin whose credentials lived in
-- environment variables (ADMIN_EMAIL, ADMIN_PASSWORD_HASH). We migrate that
-- record into the new table on the fly so nothing breaks.
--
-- NOTE: run this ONE time against the Supabase project (aprenderaleman2026).
-- It is idempotent — safe to re-run.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enum: user_role
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'teacher', 'student');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 2. users
--    One row per human that can log in, regardless of role.
--    Linked 1-to-1 with `teachers` / `students` / (implicit for admins).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 TEXT NOT NULL UNIQUE
                          CHECK (email = lower(email)),
    password_hash         TEXT NOT NULL,
    role                  user_role NOT NULL,
    full_name             TEXT,
    phone                 TEXT,
    language_preference   TEXT NOT NULL DEFAULT 'es'
                          CHECK (language_preference IN ('es', 'de')),
    active                BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at         TIMESTAMPTZ,
    must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,  -- true for auto-generated passwords
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_role_idx   ON users(role);
CREATE INDEX IF NOT EXISTS users_active_idx ON users(active) WHERE active = TRUE;

-- Auto-update `updated_at` on row change
CREATE OR REPLACE FUNCTION tg_users_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION tg_users_updated_at();


-- ---------------------------------------------------------------------------
-- 3. Seed the existing superadmin (Gelfis) from env values
--    We read them at migration-apply time via psql \gset if running from CLI,
--    OR you can replace the placeholders manually before running in Supabase.
--
--    IMPORTANT: replace the two placeholders below with the real values from
--    your .env.prod on Hetzner, then run the migration in the Supabase SQL
--    editor. If the user already exists it is left untouched.
-- ---------------------------------------------------------------------------
INSERT INTO users (email, password_hash, role, full_name, language_preference)
VALUES (
    'REPLACE_WITH_ADMIN_EMAIL',
    'REPLACE_WITH_ADMIN_PASSWORD_HASH',
    'superadmin',
    'Gelfis Horn',
    'es'
)
ON CONFLICT (email) DO NOTHING;


COMMIT;

-- -----------------------------------------------------------------------------
-- Verification queries (run AFTER the migration to confirm success):
--
--   SELECT id, email, role, active, created_at FROM users;
--   -- expected: one row for Gelfis with role='superadmin'
--
-- -----------------------------------------------------------------------------
