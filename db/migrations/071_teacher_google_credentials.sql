-- =============================================================================
-- Migration 071 — teacher_google_credentials
-- =============================================================================
-- Stores OAuth2 refresh tokens for teachers who connect their personal
-- Google Calendar. Used to:
--   1. Create trial class events in the teacher's own calendar
--   2. Query freeBusy to avoid booking them during personal appointments
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS teacher_google_credentials (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id      uuid NOT NULL UNIQUE REFERENCES teachers(id) ON DELETE CASCADE,
    access_token    text NOT NULL,
    refresh_token   text NOT NULL,
    token_expiry    timestamptz NOT NULL,
    calendar_email  text,
    scope           text NOT NULL DEFAULT 'https://www.googleapis.com/auth/calendar',
    connected_at    timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_google_creds_teacher_idx
    ON teacher_google_credentials(teacher_id);

ALTER TABLE teacher_google_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_teacher_google_creds"
    ON teacher_google_credentials
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION tg_teacher_gcreds_updated() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER teacher_gcreds_updated
    BEFORE UPDATE ON teacher_google_credentials
    FOR EACH ROW EXECUTE FUNCTION tg_teacher_gcreds_updated();

COMMIT;
