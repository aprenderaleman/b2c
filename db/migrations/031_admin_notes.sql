-- =============================================================================
-- Migration 031 — admin notes on students and teachers
-- =============================================================================
-- A simple timeline of free-form notes the admin can stick on any student
-- or teacher profile. Every note is timestamped and signed by its author,
-- so months later we can tell who said what about whom.
--
-- Intentionally ONE table for both targets (students + teachers) with a
-- discriminator column — avoids duplicating schema + API. RLS is tight:
-- only service_role can read/write; admin UI goes through the Node API.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS admin_notes (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type  TEXT        NOT NULL CHECK (target_type IN ('student', 'teacher')),
    target_id    uuid        NOT NULL,
    author_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
    content      TEXT        NOT NULL CHECK (length(content) >= 1 AND length(content) <= 10000),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot queries: "give me every note on this student/teacher newest first".
CREATE INDEX IF NOT EXISTS admin_notes_target_idx
    ON admin_notes(target_type, target_id, created_at DESC);

-- Author lookup (who's authored the most notes, or filtering).
CREATE INDEX IF NOT EXISTS admin_notes_author_idx
    ON admin_notes(author_id);

-- Keep updated_at in sync automatically.
CREATE OR REPLACE FUNCTION tg_admin_notes_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_notes_updated_at ON admin_notes;
CREATE TRIGGER admin_notes_updated_at
    BEFORE UPDATE ON admin_notes
    FOR EACH ROW EXECUTE FUNCTION tg_admin_notes_updated_at();

-- RLS — service_role only. All real access is through our API routes which
-- use supabaseAdmin() (service role) after the Next.js auth middleware
-- confirmed the caller is admin/superadmin.
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_admin_notes" ON admin_notes;
CREATE POLICY "service_role_all_admin_notes" ON admin_notes
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
