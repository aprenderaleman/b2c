-- ============================================================
-- Migration 002 — GDPR helpers (Art. 17 right to erasure)
-- ============================================================

-- Audit log of deletion events. Stores only the SHA256 of the normalized
-- phone (not the phone itself) so we can prove we handled a DSR without
-- retaining identifying data.

CREATE TABLE IF NOT EXISTS lead_deletion_log (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deleted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    phone_hash       TEXT NOT NULL,
    requested_by     TEXT NOT NULL DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_deletion_log_deleted_at
    ON lead_deletion_log(deleted_at DESC);

-- Helper: delete a lead + cascading data atomically and record the deletion.
CREATE OR REPLACE FUNCTION gdpr_delete_lead(p_lead_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_phone TEXT;
BEGIN
    SELECT whatsapp_normalized INTO v_phone FROM leads WHERE id = p_lead_id;
    IF v_phone IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO lead_deletion_log (phone_hash)
    VALUES (encode(digest(v_phone, 'sha256'), 'hex'));

    -- ON DELETE CASCADE on lead_timeline + gelfis_notes takes care of those
    -- rows automatically. message_send_log keeps lead_id NULL (ON DELETE SET NULL)
    -- so we preserve rate-limit history without keeping identifying data.
    DELETE FROM leads WHERE id = p_lead_id;
END;
$$;

-- For the digest() function.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
