-- =============================================================================
-- Migration 072 — relax lead_timeline type & author to text
-- =============================================================================
-- The view v_leads_today depends on lead_timeline.type, so we must drop it
-- first, alter the columns, then recreate the view.
-- =============================================================================

BEGIN;

-- 1. Drop dependent view
DROP VIEW IF EXISTS v_leads_today;

-- 2. Change type column from timeline_type enum → text
ALTER TABLE lead_timeline
  ALTER COLUMN type TYPE text USING type::text;

-- 3. Change author column from timeline_author enum → text
ALTER TABLE lead_timeline
  ALTER COLUMN author TYPE text USING author::text;

-- 4. Recreate the view
CREATE OR REPLACE VIEW v_leads_today AS
SELECT
    l.*,
    (SELECT COUNT(*) FROM lead_timeline t WHERE t.lead_id = l.id) AS timeline_entries,
    (SELECT MAX(timestamp) FROM lead_timeline t
        WHERE t.lead_id = l.id AND t.type = 'system_message_sent') AS last_system_message_at,
    (SELECT MAX(timestamp) FROM lead_timeline t
        WHERE t.lead_id = l.id AND t.type = 'lead_message_received') AS last_lead_message_at
FROM leads l;

COMMIT;
