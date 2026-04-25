-- =============================================================================
-- Migration 037 — fix gdpr_delete_lead for leads without WhatsApp
-- =============================================================================
-- After migration 035 made `leads.whatsapp_normalized` nullable (so the
-- self-book funnel could create email-only leads), the original
-- gdpr_delete_lead helper kept bailing on `IF v_phone IS NULL THEN
-- RETURN`. Result: admin clicked "Eliminar (RGPD)" on a self-book lead
-- and the row never went away.
--
-- This rewrite:
--   * Logs deletion using whichever contact we have (phone hash if
--     present, otherwise email hash).
--   * Always performs the DELETE (no early return).
--   * Still no-ops if the lead doesn't exist (re-running is safe).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION gdpr_delete_lead(p_lead_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_phone TEXT;
    v_email TEXT;
    v_hash  TEXT;
BEGIN
    SELECT whatsapp_normalized, email
      INTO v_phone, v_email
      FROM leads
     WHERE id = p_lead_id;

    -- No row → nothing to do (idempotent).
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Pick the most stable identifier we have for the audit hash.
    -- Self-book funnel leads typically only have email; legacy leads
    -- have phone. Either way we record SHA256(value), never the value
    -- itself.
    IF v_phone IS NOT NULL THEN
        v_hash := encode(digest(v_phone, 'sha256'), 'hex');
    ELSIF v_email IS NOT NULL THEN
        v_hash := encode(digest(v_email, 'sha256'), 'hex');
    ELSE
        -- No contact at all — fall back to the lead's UUID so the audit
        -- row still proves "we deleted this".
        v_hash := encode(digest(p_lead_id::text, 'sha256'), 'hex');
    END IF;

    INSERT INTO lead_deletion_log (phone_hash) VALUES (v_hash);

    -- ON DELETE CASCADE / SET NULL on the FK side handles dependent
    -- rows (lead_timeline, gelfis_notes, classes.lead_id, etc.).
    DELETE FROM leads WHERE id = p_lead_id;
END;
$$;

COMMIT;
