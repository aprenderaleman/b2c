-- 056_ads_conversion_tracking.sql
-- Tracking de conversiones offline para Google Ads (lead → cliente).
--
-- Para atribuir una conversión offline (un lead que se vuelve cliente
-- de pago días después) al anuncio que lo trajo, Google Ads necesita
-- el GCLID — el identificador de clic que Google añade a la URL del
-- anuncio (?gclid=...). Lo capturamos al aterrizar el lead y lo
-- subimos junto a la conversión vía una Google Sheet conectada.
--
-- Campos:
--   gclid / gbraid / wbraid  — IDs de clic de Google (gbraid/wbraid son
--                              para iOS donde gclid no está disponible).
--   utm_*                    — atribución de campaña (informe interno).
--   converted_at             — cuándo el lead pasó a 'converted'.
--   conversion_value         — valor del trato (EUR). Default lo pone
--                              el cron si no se especifica.
--   ads_conversion_uploaded_at — marca anti-duplicado: cuándo se subió
--                              ya esta conversión a la Sheet de Google Ads.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS gclid                       TEXT,
  ADD COLUMN IF NOT EXISTS gbraid                      TEXT,
  ADD COLUMN IF NOT EXISTS wbraid                      TEXT,
  ADD COLUMN IF NOT EXISTS utm_source                  TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium                  TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign                TEXT,
  ADD COLUMN IF NOT EXISTS utm_term                    TEXT,
  ADD COLUMN IF NOT EXISTS utm_content                 TEXT,
  ADD COLUMN IF NOT EXISTS converted_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conversion_value            NUMERIC,
  ADD COLUMN IF NOT EXISTS ads_conversion_uploaded_at  TIMESTAMPTZ;

-- Índice para que el cron de export encuentre rápido las conversiones
-- pendientes de subir (converted con gclid y sin subir todavía).
CREATE INDEX IF NOT EXISTS leads_ads_conversion_pending_idx
  ON leads (converted_at)
  WHERE status = 'converted' AND gclid IS NOT NULL AND ads_conversion_uploaded_at IS NULL;
