-- =============================================================================
-- Migration 027 — shared_materials
-- =============================================================================
-- Central catalog of official Aprender-Aleman.de lessons (links to Gamma
-- presentations). Shared across ALL teachers and surfaced to students
-- filtered by their CEFR level.
--
-- No upload/editing from the app for now — the rows are seeded from the
-- Google Doc master list via scripts/seed_shared_materials.mjs and edited
-- manually when new lessons are added (one migration per add).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS shared_materials (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    level          cefr_level NOT NULL,                 -- A1/A2/B1/B2
    module_name    TEXT,                                 -- e.g. "Modul 1: B1-Refresher"
    lesson_number  INTEGER,                              -- 1..N within the level (null for summaries)
    title          TEXT NOT NULL,
    subtitle       TEXT,                                 -- grammar focus, etc. "(Imperativ)"
    gamma_url      TEXT NOT NULL,
    is_summary     BOOLEAN NOT NULL DEFAULT FALSE,       -- true for level wrap-up pages
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_materials_level_idx
    ON shared_materials(level, lesson_number)
    WHERE active = TRUE;

-- Unique on (level, gamma_url) so the seed script is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS shared_materials_unique_idx
    ON shared_materials(level, gamma_url);

CREATE OR REPLACE FUNCTION tg_shared_materials_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shared_materials_updated_at ON shared_materials;
CREATE TRIGGER shared_materials_updated_at
    BEFORE UPDATE ON shared_materials
    FOR EACH ROW EXECUTE FUNCTION tg_shared_materials_updated_at();

ALTER TABLE shared_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_shared_materials" ON shared_materials;
CREATE POLICY "service_role_all_shared_materials" ON shared_materials
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
