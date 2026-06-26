-- Migration 074: leads.email_status para tracking bounces/complaints Resend
--
-- Cuando Resend reporta bounce/complaint/delivery_delayed/etc. lo
-- registramos aquí para PARAR todos los envíos automáticos a ese lead.
-- Sin esto, seguiríamos bombardeando emails inválidos y dañando la
-- reputación del dominio @send.aprender-aleman.de.
--
-- Valores posibles (texto libre por simplicidad — no enum):
--   - "delivered"     → último envío confirmado entregado (opcional, info)
--   - "bounced"       → rebote permanente (hard bounce). PARAR envíos.
--   - "complained"    → lead reportó como spam. PARAR envíos.
--   - "delivery_delayed" → soft bounce, reintentar después
--   - NULL (default)  → sin info, asumimos válido
--
-- email_status_at = momento del último evento Resend.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email_status    TEXT,
  ADD COLUMN IF NOT EXISTS email_status_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_email_status_idx
  ON leads (email_status)
  WHERE email_status IS NOT NULL;

COMMENT ON COLUMN leads.email_status IS
  'Estado del email reportado por Resend webhook. NULL=válido por defecto. '
  '"bounced"/"complained" → cron handlers deben saltar a este lead.';
COMMENT ON COLUMN leads.email_status_at IS
  'Timestamp del último evento Resend (set por /api/webhooks/resend).';
