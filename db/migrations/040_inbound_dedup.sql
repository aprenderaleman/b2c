-- =============================================================================
-- Migration 040 — inbound_dedup
-- =============================================================================
-- Tabla pequeña que registra cada `key.id` de mensaje WhatsApp procesado por
-- el webhook. Sirve para deduplicar reintentos de Evolution: cuando el handler
-- es síncrono y tarda más que el timeout de Evolution (~5-10s), Evolution
-- reintenta con el MISMO key.id y se generaba la respuesta múltiples veces
-- (ver caso Christian Moresi 2026-04-29 19:02-19:04 UTC).
--
-- Ahora el webhook intenta INSERT en esta tabla y, si falla por unique
-- violation, sabe que es un retry y devuelve 200 sin procesar.
--
-- Cleanup: un job en scheduler.py borra entries >7 días.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS inbound_dedup (
    wa_message_id  TEXT PRIMARY KEY,
    received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_dedup_received_at_idx
    ON inbound_dedup (received_at);

ALTER TABLE inbound_dedup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_inbound_dedup" ON inbound_dedup;
CREATE POLICY "service_role_all_inbound_dedup" ON inbound_dedup
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
