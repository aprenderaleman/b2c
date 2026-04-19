-- =============================================================================
-- Migration 026 — impersonation_log
-- =============================================================================
-- Audit trail for every "view as" action an admin performs. Every call to
-- /api/admin/impersonate/start writes a row here; /stop updates ended_at.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS impersonation_log (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at       TIMESTAMPTZ,
    ip             INET,
    user_agent     TEXT
);

CREATE INDEX IF NOT EXISTS impersonation_log_admin_idx  ON impersonation_log(admin_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS impersonation_log_target_idx ON impersonation_log(target_user_id, started_at DESC);

ALTER TABLE impersonation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_impersonation_log" ON impersonation_log;
CREATE POLICY "service_role_all_impersonation_log" ON impersonation_log
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
