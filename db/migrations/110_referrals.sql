-- 110: Sistema de referidos "Regala una clase — gana 3" (Gelfis 2026-08-14)
--
-- students.referral_code       → código corto único (GELF-3F2K), lazy
-- students.last_referral_popup_at → throttle del popup de victorias (1/mes)
-- leads.referred_by            → student_id del referidor (first-touch)
-- leads.referral_rewarded_at   → idempotencia de la recompensa (se
--                                setea UNA vez al convertir; el UPDATE
--                                condicional WHERE IS NULL es el lock)

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS referral_code           TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS last_referral_popup_at  TIMESTAMPTZ;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS referred_by             UUID REFERENCES students(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_rewarded_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_referred_by
  ON leads (referred_by) WHERE referred_by IS NOT NULL;

-- Tipo de notificación in-app para la celebración de la recompensa.
-- (ADD VALUE no puede ir en la misma transacción que lo demás — el
-- script de apply lo ejecuta por separado.)
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'referral_reward';
