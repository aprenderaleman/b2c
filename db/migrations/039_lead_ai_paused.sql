-- 039_lead_ai_paused.sql
--
-- Lets the admin take over a WhatsApp conversation manually without
-- changing the lead's funnel status. Stiv (the AI assistant) checks
-- this column at the top of `agent_4_conversation.handle_incoming_message`
-- and short-circuits if the pause is still active — so when Gelfis
-- clicks "Tomo yo desde aquí" the bot stops replying without losing
-- any other context (status, follow-up counters, etc).
--
-- NULL → AI free to reply (default).
-- > now() → AI silently holds back; admin handles the conversation.
-- < now() → expired, treated as NULL (no need for a cron to clear it).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_paused_until timestamptz;

COMMENT ON COLUMN leads.ai_paused_until IS
  'Stiv (AI) holds replies while this is in the future. Set by the admin via /api/admin/leads/[id]/ai-pause; cleared by the same endpoint with paused=false.';
