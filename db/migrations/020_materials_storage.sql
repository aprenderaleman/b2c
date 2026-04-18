-- =============================================================================
-- Migration 020 — materials library + storage buckets
-- =============================================================================
-- Teachers upload reusable materials (PDFs, images, audio, video). Tagged
-- by level / skill / topic. Can be shared to a specific class or kept
-- private. We also provision the Supabase Storage buckets used by chat
-- attachments + materials at migration time.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- materials table
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE material_visibility AS ENUM ('private', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS materials (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id    uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,

    title         TEXT NOT NULL,
    description   TEXT,

    -- Storage: the object lives in Supabase Storage at `materials/<path>`.
    storage_path  TEXT NOT NULL,                              -- e.g. "teacher-id/uuid.pdf"
    file_url      TEXT NOT NULL,                              -- resolved signed URL or public URL
    file_name     TEXT NOT NULL,
    file_type     TEXT NOT NULL,                              -- MIME
    file_size_bytes INTEGER,

    tags          TEXT[] NOT NULL DEFAULT '{}'::TEXT[],       -- ["A1","vocab","travel"]
    visibility    material_visibility NOT NULL DEFAULT 'private',

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS materials_teacher_idx
    ON materials(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS materials_tags_idx
    ON materials USING GIN (tags);

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_materials" ON materials;
CREATE POLICY "service_role_all_materials" ON materials
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');


-- ---------------------------------------------------------------------------
-- Supabase Storage buckets (idempotent insert into storage.buckets)
-- ---------------------------------------------------------------------------
-- "chat-uploads"  → user-to-user attachments (10 MB per file, any MIME)
-- "materials"     → teacher materials (50 MB per file)
-- Both private; we serve signed URLs or proxy through the API.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('chat-uploads', 'chat-uploads', FALSE, 10 * 1024 * 1024)
    ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('materials', 'materials', FALSE, 50 * 1024 * 1024)
    ON CONFLICT (id) DO NOTHING;

COMMIT;
