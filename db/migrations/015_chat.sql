-- =============================================================================
-- Migration 015 — chat system
-- =============================================================================
-- Direct (1-to-1) and group chats. Direct chats auto-create between a student
-- and their teacher when the first class is assigned. Group chats auto-create
-- when a group class is scheduled (anchored to the parent_class_id of the
-- recurring series so every instance shares one persistent chat).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE chat_type AS ENUM ('direct', 'group');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- chats
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chats (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type                chat_type NOT NULL,
    -- For group chats, anchored to the parent class (one chat per recurring
    -- series, not per instance).
    class_group_id      uuid REFERENCES classes(id) ON DELETE CASCADE,
    -- Display title: for direct chats usually the other person's name
    -- (computed client-side); for groups this is the admin-chosen title.
    title               TEXT,
    last_message_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chats_last_message_idx ON chats(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS chats_class_group_idx  ON chats(class_group_id) WHERE class_group_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- chat_participants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id        uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_at   TIMESTAMPTZ,
    muted          BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_participants_user_idx ON chat_participants(user_id);


-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id                uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    author_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content                TEXT NOT NULL,
    -- Array of {url, name, size, content_type} — populated when a user
    -- attaches files from Supabase Storage.
    attachments            JSONB NOT NULL DEFAULT '[]'::JSONB,
    reply_to_message_id    uuid REFERENCES messages(id) ON DELETE SET NULL,
    edited_at              TIMESTAMPTZ,
    deleted                BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_chat_sent_idx ON messages(chat_id, sent_at);
CREATE INDEX IF NOT EXISTS messages_author_idx    ON messages(author_id);

-- Bump chats.last_message_at so the conversation list stays sorted.
CREATE OR REPLACE FUNCTION tg_messages_bump_chat_last_message() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'INSERT') AND (NEW.deleted = FALSE) THEN
        UPDATE chats SET last_message_at = NEW.sent_at WHERE id = NEW.chat_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_bump_chat_last_message ON messages;
CREATE TRIGGER messages_bump_chat_last_message
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION tg_messages_bump_chat_last_message();


-- ---------------------------------------------------------------------------
-- RLS — service_role only for now (same pattern as 009+). Finer auth-uid
-- policies land in a later migration once we expose the Supabase anon key
-- to the browser; today every chat access goes through our API.
-- ---------------------------------------------------------------------------
ALTER TABLE chats              ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['chats','chat_participants','messages']) LOOP
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
