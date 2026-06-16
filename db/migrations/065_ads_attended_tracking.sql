-- 065_ads_attended_tracking.sql
--
-- Smart Bidding en cascada (Gelfis 2026-06-16) — habilita 2 conversion
-- actions distintas en Google Ads para que el bidding aprenda calidad
-- real del lead, no solo "reservó":
--
--   1. "Cliente convertido (offline)"  → leads.status='converted'      (ya existía)
--   2. "Asistió a clase de prueba"      → leads.trial_attended_at !=   (NUEVA)
--
-- El cron `ads-conversions-export` sube ambas a la misma Google Sheet
-- con el `conversionName` correspondiente y Google Ads las atribuye al
-- gclid del clic original. Smart Bidding optimiza el primary
-- (configurable en Google Ads UI — recomendado: "paid" cuando hay
-- volumen, "attended" si no).
--
-- Anti-duplicado: cada tipo tiene su propio timestamp `ads_*_uploaded_at`.
-- El timestamp existente `ads_conversion_uploaded_at` se mantiene como
-- está (semánticamente = "paid") sin renombrar para no romper código
-- legacy ni datos históricos.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ads_attended_uploaded_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.ads_attended_uploaded_at IS
  'Timestamp cuando subimos la conversion "Asistió a clase de prueba" a Google Ads vía cron ads-conversions-export. NULL = pendiente de subir.';

-- Índice parcial para la query del cron (gclid + attended + no subida).
-- Sin esto la query escanea toda la tabla — barato hoy pero crece.
CREATE INDEX IF NOT EXISTS idx_leads_pending_ads_attended_upload
  ON leads (trial_attended_at)
  WHERE
    gclid IS NOT NULL
    AND trial_attended_at IS NOT NULL
    AND ads_attended_uploaded_at IS NULL;

COMMIT;
