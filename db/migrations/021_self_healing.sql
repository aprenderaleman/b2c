-- =============================================================================
-- Migration 021 — self-healing infrastructure
-- =============================================================================
-- Groundwork for the janitor job that keeps the agents stack alive without
-- human intervention:
--
--   * system_heartbeat     — one row per service, updated every tick so we
--                             can detect a frozen scheduler from inside the
--                             scheduler itself.
--   * system_config        — add 'last_critical_issue' for the admin banner.
--
-- No new enum types; no new triggers. Designed to be append-only to the
-- existing schema so we can run it safely while the scheduler is running.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS system_heartbeat (
    service       TEXT PRIMARY KEY,                          -- "scheduler" | "webhook" | "evolution" | …
    last_tick     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cycle_count   BIGINT NOT NULL DEFAULT 0,                 -- monotonic counter
    last_note     TEXT,                                       -- short status line
    details       JSONB NOT NULL DEFAULT '{}'::JSONB,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION tg_heartbeat_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS heartbeat_updated_at ON system_heartbeat;
CREATE TRIGGER heartbeat_updated_at
    BEFORE UPDATE ON system_heartbeat
    FOR EACH ROW EXECUTE FUNCTION tg_heartbeat_updated_at();

-- Seed the two services we know about. Value is deliberately old so
-- the first real tick ships a fresh timestamp immediately.
INSERT INTO system_heartbeat (service, last_note)
VALUES ('scheduler', 'awaiting first tick'),
       ('janitor',   'awaiting first tick')
    ON CONFLICT (service) DO NOTHING;


-- The admin banner key. Stored as plain text; janitor writes / clears it.
INSERT INTO system_config (key, value)
VALUES ('last_critical_issue', '')
    ON CONFLICT (key) DO NOTHING;


-- RLS: these tables are admin-internal; service_role only.
ALTER TABLE system_heartbeat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_system_heartbeat" ON system_heartbeat;
CREATE POLICY "service_role_all_system_heartbeat" ON system_heartbeat
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
