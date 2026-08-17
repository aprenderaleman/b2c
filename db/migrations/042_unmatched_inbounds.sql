-- =============================================================================
-- Migration 042 — unmatched_inbounds + inbound_processing_queue
-- =============================================================================
-- Tabla 1: unmatched_inbounds — registra cada inbound de WhatsApp que el
-- webhook no pudo asociar a un lead (LID nuevo + pushName ambiguo + sin
-- outbound reciente). Un cron escanea cada 10 min y alerta a Gelfis para
-- que pueda mapearlo manualmente desde /admin si es un lead real.
--
-- Tabla 2: inbound_processing_queue — cola persistente de mensajes ya
-- resueltos al lead pero pendientes de procesar por Agent 4. Si la tarea
-- en background falla (BackgroundTasks crash, AI timeout, etc.), el row
-- queda 'pending' y un cron reintenta hasta 3 veces, luego escala.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────
-- unmatched_inbounds
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unmatched_inbounds (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    jid               TEXT NOT NULL,
    push_name         TEXT,
    content_preview   TEXT,
    candidates        TEXT,                  -- JSON-ish summary de leads candidatos
    raw_payload       JSONB,
    resolved_at       TIMESTAMPTZ,
    resolved_lead_id  UUID REFERENCES leads(id) ON DELETE SET NULL,
    notified_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_unmatched_unresolved
    ON unmatched_inbounds (received_at) WHERE resolved_at IS NULL;

ALTER TABLE unmatched_inbounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_unmatched" ON unmatched_inbounds;
CREATE POLICY "service_role_all_unmatched" ON unmatched_inbounds
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────
-- inbound_processing_queue
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbound_processing_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    wa_message_id   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','failed_permanent')),
    retry_count     INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    last_attempt_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_queue_pending
    ON inbound_processing_queue (next_attempt_at)
    WHERE status = 'pending';

ALTER TABLE inbound_processing_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_inbound_queue" ON inbound_processing_queue;
CREATE POLICY "service_role_all_inbound_queue" ON inbound_processing_queue
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
