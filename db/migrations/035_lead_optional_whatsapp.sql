-- =============================================================================
-- Migration 035 — make WhatsApp optional on leads
-- =============================================================================
-- The new self-book trial funnel collects email as the primary contact and
-- treats WhatsApp as opt-in. The historic schema required both
-- `whatsapp_normalized` and `whatsapp_raw` because the old funnel always
-- went through WhatsApp. Relax both constraints so leads can be created
-- with email-only contact.
-- =============================================================================

BEGIN;

ALTER TABLE leads
    ALTER COLUMN whatsapp_normalized DROP NOT NULL,
    ALTER COLUMN whatsapp_raw        DROP NOT NULL;

COMMIT;
