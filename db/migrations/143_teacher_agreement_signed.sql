-- 143: Acuerdo firmado por la academia antes de aprobar al profe
-- (Gelfis 2026-10-15). La firma de Gelfis se guarda una vez en Storage
-- (materials/firmas/<admin_user_id>.png) y se estampa en el PDF.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS agreement_signed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agreement_signed_path TEXT;
