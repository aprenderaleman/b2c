-- Migration 069: Summer promo campaign tracking (Gelfis 2026-06-19)
--
-- Campaña "Deutsch im Sommer" — promo para leads no convertidos:
-- 3 mensajes WA por nivel (A0/A1/A2/B1/B2/C1/unknown) con cadencia:
--   msg 1 → inmediato (al arrancar la campaña)
--   msg 2 → +4 días desde started_at
--   msg 3 → +10 días desde started_at
-- Si lead responde → status=needs_human + step=4 (para la cadena).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS summer_promo_step smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS summer_promo_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS summer_promo_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS summer_promo_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS summer_promo_horario      text;  -- "mañana"|"tarde"|"noche"|"finde"

CREATE INDEX IF NOT EXISTS leads_summer_promo_active_idx
  ON leads (summer_promo_step, summer_promo_last_sent_at)
  WHERE summer_promo_step BETWEEN 1 AND 3;

COMMENT ON COLUMN leads.summer_promo_step IS
  '0=no enviado · 1/2/3=último msg enviado · 4=respondió/needs_human (cadena cerrada)';
