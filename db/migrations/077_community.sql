-- =============================================================================
-- Migration 077 — community social feed
-- =============================================================================
-- Public social feed where students and teachers interact. Users create
-- posts (text + optional image), give likes, and leave comments. Posts
-- appear in a shared chronological feed at /comunidad.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content      TEXT NOT NULL CHECK (char_length(content) <= 2000),
    -- Optional image stored in Supabase Storage bucket "comunidad".
    image_url    TEXT,
    image_path   TEXT,
    pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_author_idx  ON posts(author_id);

CREATE OR REPLACE FUNCTION tg_posts_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_updated_at ON posts;
CREATE TRIGGER posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION tg_posts_updated_at();


-- ---------------------------------------------------------------------------
-- post_likes  (one per user per post)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS post_likes (
    post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_likes_user_idx ON post_likes(user_id);


-- ---------------------------------------------------------------------------
-- post_comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS post_comments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL CHECK (char_length(content) <= 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_comments_post_idx
    ON post_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS post_comments_author_idx
    ON post_comments(author_id);


-- ---------------------------------------------------------------------------
-- Denormalized counters on posts (avoid COUNT(*) on every feed load)
-- ---------------------------------------------------------------------------
ALTER TABLE posts ADD COLUMN IF NOT EXISTS like_count    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0;

-- Auto-increment / decrement like_count
CREATE OR REPLACE FUNCTION tg_post_likes_count() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts SET like_count = like_count - 1 WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_likes_count ON post_likes;
CREATE TRIGGER post_likes_count
    AFTER INSERT OR DELETE ON post_likes
    FOR EACH ROW EXECUTE FUNCTION tg_post_likes_count();

-- Auto-increment / decrement comment_count
CREATE OR REPLACE FUNCTION tg_post_comments_count() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts SET comment_count = comment_count - 1 WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_comments_count ON post_comments;
CREATE TRIGGER post_comments_count
    AFTER INSERT OR DELETE ON post_comments
    FOR EACH ROW EXECUTE FUNCTION tg_post_comments_count();


-- ---------------------------------------------------------------------------
-- Extend notification_type enum for community events
-- ---------------------------------------------------------------------------
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'post_liked';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'post_commented';


-- ---------------------------------------------------------------------------
-- avatar_url on users (used by community profile cards)
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT CHECK (char_length(bio) <= 300);


-- ---------------------------------------------------------------------------
-- Supabase Storage bucket for community images
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('comunidad', 'comunidad', FALSE, 5 * 1024 * 1024)
    ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- RLS — service_role only (same pattern as chat/notifications)
-- ---------------------------------------------------------------------------
ALTER TABLE posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['posts','post_likes','post_comments']) LOOP
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
