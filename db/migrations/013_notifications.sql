-- =============================================================================
-- Migration 013 — notifications
-- =============================================================================
-- Simple in-app notification feed. One row per (user, event). Bell-icon
-- unread count queries hit `read_at IS NULL`.
--
-- The mirror WhatsApp / email send is NOT stored here — that's decoupled
-- and logged to lead_timeline (for students who are also leads) or just to
-- server logs. Phase 6 can add a `delivery_log` table if we need richer
-- audit.
-- =============================================================================

BEGIN;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'class_scheduled',    -- admin just created a class
        'class_reminder_24h', -- one day before start
        'class_reminder_1h',
        'class_reminder_15m',
        'class_cancelled',
        'class_updated',
        'class_starting',     -- teacher went live
        'recording_ready',
        'homework_new',
        'homework_reviewed',
        'generic'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         notification_type NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    -- Where clicking the notification should go. Relative path.
    link         TEXT,
    -- Optional FK (soft) back to the originating class, so the reminder
    -- cron can dedupe (don't send the same 24h reminder twice).
    class_id     uuid REFERENCES classes(id) ON DELETE CASCADE,
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON notifications(user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_class_type_idx
    ON notifications(class_id, type)
    WHERE class_id IS NOT NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_notifications" ON notifications;
CREATE POLICY "service_role_all_notifications" ON notifications
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
