-- =============================================================================
-- Migration 008 — leads.converted_to_user_id
-- =============================================================================
-- Adds a back-reference from `leads` to the `users` row that was created
-- when the lead was converted to a student. Makes "Ver como estudiante →"
-- navigation from /admin/leads/[id] cheap (no reverse lookup on students).
--
-- Kept nullable: leads that were never converted just have NULL here.
-- =============================================================================

BEGIN;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS converted_to_user_id uuid
        REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_converted_user_idx
    ON leads(converted_to_user_id) WHERE converted_to_user_id IS NOT NULL;

COMMIT;
