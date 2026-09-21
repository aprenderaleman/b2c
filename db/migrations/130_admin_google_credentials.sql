-- =============================================================================
-- Migration 130 — admin_google_credentials (Google Drive del admin)
-- =============================================================================
-- Sept 2026: Google dejó de dar almacenamiento a las cuentas de servicio
-- ("The user's Drive storage quota has been exceeded"), así que los
-- "Apuntes de Clase" ya no se pueden crear con la service account. A
-- partir de ahora los crea la cuenta Google de un admin (Gelfis) vía OAuth
-- con scope drive: el documento es suyo, vive en su carpeta y se comparte
-- con el profe. Gemelo de 111_closer_google_credentials.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS admin_google_credentials (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    access_token    text NOT NULL,
    refresh_token   text NOT NULL,
    token_expiry    timestamptz NOT NULL,
    google_email    text,
    scope           text NOT NULL DEFAULT 'https://www.googleapis.com/auth/drive',
    connected_at    timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_google_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_admin_google_creds" ON admin_google_credentials;
CREATE POLICY "service_role_all_admin_google_creds"
    ON admin_google_credentials
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION tg_admin_gcreds_updated() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_gcreds_updated ON admin_google_credentials;
CREATE TRIGGER admin_gcreds_updated
    BEFORE UPDATE ON admin_google_credentials
    FOR EACH ROW EXECUTE FUNCTION tg_admin_gcreds_updated();

COMMIT;
