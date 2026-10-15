-- 142: Acuerdo de Colaboración enviado al profe en el email de bienvenida
-- (Gelfis 2026-10-15). Se genera un PDF personalizado al aprobar y se
-- guarda copia en Storage (bucket materials, acuerdos/<teacher_id>.pdf).
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS agreement_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agreement_version TEXT,
  ADD COLUMN IF NOT EXISTS agreement_path    TEXT;
