-- =============================================================================
-- Migration 043 — RPCs para /admin/system dashboard
-- =============================================================================
-- count_silent_inbounds():
--   Cuenta leads activos que escribieron en última 1h (>15min ago) y nadie
--   les respondió. Mismo criterio que el watchdog Python — exponemos como
--   RPC para que el dashboard lo consulte sin replicar el SQL en JS.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION count_silent_inbounds() RETURNS integer AS $$
DECLARE
    n integer;
BEGIN
    SELECT COUNT(DISTINCT li.lead_id) INTO n
      FROM (
        SELECT lt.lead_id, MAX(lt.timestamp) AS last_at
          FROM lead_timeline lt
         WHERE lt.type = 'lead_message_received'
           AND lt.timestamp > NOW() - INTERVAL '1 hour'
           AND lt.timestamp < NOW() - INTERVAL '15 minutes'
         GROUP BY lt.lead_id
      ) li
      JOIN leads l ON l.id = li.lead_id
     WHERE l.status NOT IN ('lost','converted','needs_human','cold')
       AND (l.ai_paused_until IS NULL OR l.ai_paused_until <= NOW())
       AND NOT EXISTS (
           SELECT 1 FROM lead_timeline lt3
            WHERE lt3.lead_id = li.lead_id
              AND lt3.timestamp > li.last_at
              AND lt3.type IN ('system_message_sent','status_change','escalation')
       );
    RETURN COALESCE(n, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION count_silent_inbounds() TO service_role;

COMMIT;
