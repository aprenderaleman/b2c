-- ============================================================
-- Migration 003 — WhatsApp LID mapping
-- ============================================================
-- WhatsApp's privacy system (2024+) sends inbound messages with an opaque
-- `@lid` identifier instead of the phone number. We learn each lead's LID
-- from the first inbound message (matched by pushName) and persist it so
-- subsequent messages match directly without name comparison.

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS whatsapp_lid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_lid
    ON leads (whatsapp_lid)
    WHERE whatsapp_lid IS NOT NULL;
