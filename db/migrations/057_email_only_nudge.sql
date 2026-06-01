-- 057_email_only_nudge.sql
-- Cuando el lead llena el form pero NO deja WhatsApp (form 2-pasos,
-- pulsó "Continuar sin WhatsApp"), entra en un drip por email mucho
-- más agresivo que el normal para empujarlo a volver al funnel y
-- añadir su número.
--
-- Schedule del nudge: T+30min, T+6h, T+24h, T+3d, T+7d (5 toques
-- adicionales al drip normal). Cuenta en `email_only_nudge_count` y
-- timestamp en `last_email_only_nudge_at`.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email_only_nudge_count    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_email_only_nudge_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_email_only_nudge_pending_idx
  ON leads (last_email_only_nudge_at, created_at)
  WHERE whatsapp_normalized IS NULL
    AND status = 'registered'
    AND email IS NOT NULL;
