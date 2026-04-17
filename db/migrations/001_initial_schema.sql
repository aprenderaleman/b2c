-- ============================================================
-- APRENDER-ALEMAN.DE — B2C SYSTEM
-- Migration 001: Initial schema
-- ============================================================
-- Tables: leads, lead_timeline, gelfis_notes, system_config,
--         response_cache, message_send_log
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy text search on names

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
    CREATE TYPE lead_language AS ENUM ('es', 'de');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE german_level AS ENUM ('A0', 'A1-A2', 'B1', 'B2+');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE lead_goal AS ENUM (
        'work',           -- Trabajar en DACH
        'visa',           -- Visa o residencia
        'studies',        -- Estudiar en universidad alemana
        'exam',           -- Examen oficial (Goethe, TELC)
        'travel',         -- Viajes y cultura
        'already_in_dach' -- Ya vive en DACH, quiere mejorar
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE lead_urgency AS ENUM (
        'asap',
        'under_3_months',
        'in_6_months',
        'next_year',
        'just_looking'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE lead_status AS ENUM (
        'new',
        'contacted_1',
        'contacted_2',
        'contacted_3',
        'contacted_4',
        'contacted_5',
        'in_conversation',
        'link_sent',
        'trial_scheduled',
        'trial_reminded',
        'trial_absent',
        'absent_followup_1',
        'absent_followup_2',
        'absent_followup_3',
        'needs_human',
        'converted',
        'cold',
        'lost'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE timeline_type AS ENUM (
        'system_message_sent',
        'lead_message_received',
        'status_change',
        'agent_note',
        'gelfis_note',
        'calendly_event',
        'trial_reminder',
        'conversion',
        'escalation',
        'send_failed',
        'whatsapp_read_receipt'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE timeline_author AS ENUM (
        'agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4', 'agent_5',
        'gelfis', 'system', 'lead'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABLE: leads
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Identity
    name                      TEXT        NOT NULL,
    whatsapp_normalized       TEXT        NOT NULL UNIQUE,   -- E.164, e.g. +4915253409644
    whatsapp_raw              TEXT        NOT NULL,
    email                     TEXT,                            -- nullable, filled from Calendly if any
    language                  lead_language NOT NULL,

    -- Funnel data
    german_level              german_level NOT NULL,
    goal                      lead_goal    NOT NULL,
    urgency                   lead_urgency NOT NULL,
    budget                    TEXT,                            -- nullable, filled later from conversation

    -- State machine
    status                    lead_status  NOT NULL DEFAULT 'new',
    current_followup_number   INTEGER      NOT NULL DEFAULT 0,
    next_contact_date         TIMESTAMPTZ,

    -- Trial
    trial_scheduled_at        TIMESTAMPTZ,
    trial_zoom_link           TEXT,

    -- GDPR
    gdpr_accepted             BOOLEAN      NOT NULL DEFAULT FALSE,
    gdpr_accepted_at          TIMESTAMPTZ,

    -- Source tracking
    source                    TEXT         NOT NULL DEFAULT 'funnel',

    -- WhatsApp read receipts
    last_message_seen_at      TIMESTAMPTZ,
    messages_seen_count       INTEGER      NOT NULL DEFAULT 0,

    -- Which WhatsApp instance handled this lead (for rotation)
    whatsapp_instance         TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_next_contact ON leads(next_contact_date) WHERE next_contact_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_language ON leads(language);
CREATE INDEX IF NOT EXISTS idx_leads_goal ON leads(goal);
CREATE INDEX IF NOT EXISTS idx_leads_trial_scheduled_at ON leads(trial_scheduled_at) WHERE trial_scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm ON leads USING GIN (name gin_trgm_ops);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: lead_timeline
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_timeline (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    type        timeline_type NOT NULL,
    content     TEXT NOT NULL,
    author      timeline_author NOT NULL,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_timeline_lead ON lead_timeline(lead_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_type ON lead_timeline(type);

-- ============================================================
-- TABLE: gelfis_notes
-- ============================================================
-- Notes are NEVER deleted.

CREATE TABLE IF NOT EXISTS gelfis_notes (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gelfis_notes_lead ON gelfis_notes(lead_id, created_at DESC);

-- ============================================================
-- TABLE: system_config
-- ============================================================
-- Key-value store for runtime config (active WhatsApp number, daily limits, etc.)

CREATE TABLE IF NOT EXISTS system_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_system_config_updated_at ON system_config;
CREATE TRIGGER trg_system_config_updated_at
    BEFORE UPDATE ON system_config
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Seed default config
INSERT INTO system_config (key, value) VALUES
    ('active_whatsapp_number',       '+4915253409644'),
    ('backup_whatsapp_number',       ''),
    ('active_whatsapp_instance',     'aprender-aleman-main'),
    ('max_new_conversations_per_day','40'),
    ('max_outbound_messages_per_hour','10'),
    ('min_delay_seconds',            '30'),
    ('max_delay_seconds',            '90'),
    ('send_window_start_hour',       '8'),
    ('send_window_end_hour',         '22'),
    ('skip_sundays',                 'true'),
    ('system_paused',                'false')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- TABLE: response_cache
-- ============================================================
-- Caches common question responses for 24h to save API credits.

CREATE TABLE IF NOT EXISTS response_cache (
    question_hash TEXT PRIMARY KEY,
    question_raw  TEXT NOT NULL,      -- for debugging / audit
    response_es   TEXT NOT NULL,
    response_de   TEXT NOT NULL,
    cached_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hit_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_response_cache_cached_at ON response_cache(cached_at DESC);

-- ============================================================
-- TABLE: message_send_log
-- ============================================================
-- Tracks outbound WhatsApp sends for rate limiting & audit.

CREATE TABLE IF NOT EXISTS message_send_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    instance      TEXT NOT NULL,              -- which WhatsApp instance sent it
    to_number     TEXT NOT NULL,              -- normalized
    message_body  TEXT NOT NULL,
    success       BOOLEAN NOT NULL,
    error_message TEXT,
    retry_count   INTEGER NOT NULL DEFAULT 0,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_send_log_sent_at ON message_send_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_send_log_lead ON message_send_log(lead_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_send_log_instance ON message_send_log(instance, sent_at DESC);

-- ============================================================
-- TABLE: agent_run_log
-- ============================================================
-- Tracks Agent 0 cron runs for monitoring & debugging.

CREATE TABLE IF NOT EXISTS agent_run_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_name    TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ,
    leads_processed INTEGER NOT NULL DEFAULT 0,
    errors_count  INTEGER NOT NULL DEFAULT 0,
    notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_run_log_started_at ON agent_run_log(started_at DESC);

-- ============================================================
-- VIEWS — handy aggregates for the dashboard
-- ============================================================

CREATE OR REPLACE VIEW v_leads_today AS
SELECT
    l.*,
    (SELECT COUNT(*) FROM lead_timeline t WHERE t.lead_id = l.id) AS timeline_entries,
    (SELECT MAX(timestamp) FROM lead_timeline t
        WHERE t.lead_id = l.id AND t.type = 'system_message_sent') AS last_system_message_at,
    (SELECT MAX(timestamp) FROM lead_timeline t
        WHERE t.lead_id = l.id AND t.type = 'lead_message_received') AS last_lead_message_at
FROM leads l;

-- ============================================================
-- ROW LEVEL SECURITY — lock everything down, access via service role
-- ============================================================
-- The Next.js admin and Python agents use the SERVICE_ROLE key which
-- bypasses RLS. The public funnel uses a dedicated API route that
-- validates and inserts via service role on the server.
-- The anon key should NOT be used to read any of these tables directly.

ALTER TABLE leads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_timeline      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gelfis_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_cache     ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_send_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_log      ENABLE ROW LEVEL SECURITY;

-- No anon policies defined — table is unreachable without service_role.

-- ============================================================
-- END OF MIGRATION 001
-- ============================================================
