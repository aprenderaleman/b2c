-- 125: terms_acceptances — campos de cruce con aprender-aleman.de
--
-- Coordinado con la sesión legal (FASE 2): el wording final del
-- checkbox incluye también la Política de privacidad, y los acceptance
-- records de ambos sistemas se cruzan por stripe_session_id + lead_id
-- distinguiendo el origen con `source` ("b2c-checkout" aquí,
-- "aprender-aleman-web" en su tabla legal_acceptances).

ALTER TABLE terms_acceptances
  ADD COLUMN IF NOT EXISTS privacy_version text,
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'b2c-checkout';
