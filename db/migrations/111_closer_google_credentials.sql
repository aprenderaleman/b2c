-- =============================================================================
-- Migration 111 — closer_google_credentials
-- =============================================================================
-- Gemelo de 071_teacher_google_credentials, pero para closers.
-- Los closers son filas en `users` con role='closer' (no tienen entrada en
-- `teachers`), por lo que necesitan su propia tabla de OAuth tokens.
--
-- Uso: al bookear una Sesión de Plan desde /sesion-plan, creamos un evento
-- en el Google Calendar personal del closer que la recibe. El evento se
-- almacena en `classes.closer_gcal_event_id` (columna nueva, separada de
-- `google_calendar_event_id` que apunta al calendar compartido de trials).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS closer_google_credentials (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    closer_id       uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    access_token    text NOT NULL,
    refresh_token   text NOT NULL,
    token_expiry    timestamptz NOT NULL,
    calendar_email  text,
    scope           text NOT NULL DEFAULT 'https://www.googleapis.com/auth/calendar',
    connected_at    timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS closer_google_creds_closer_idx
    ON closer_google_credentials(closer_id);

ALTER TABLE closer_google_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_closer_google_creds"
    ON closer_google_credentials
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION tg_closer_gcreds_updated() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER closer_gcreds_updated
    BEFORE UPDATE ON closer_google_credentials
    FOR EACH ROW EXECUTE FUNCTION tg_closer_gcreds_updated();

-- Column for the mirror event in the closer's calendar. Separado de
-- google_calendar_event_id (que apunta al calendar compartido de Gelfis
-- para trials) porque son calendars distintos y las cancelaciones deben
-- borrar en el calendar correcto.
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS closer_gcal_event_id text;

COMMENT ON COLUMN classes.closer_gcal_event_id IS
  'ID del evento en el Google Calendar personal del closer (OAuth per-closer). NULL si el closer no vinculó calendar o el insert falló — no bloqueante.';

COMMIT;
