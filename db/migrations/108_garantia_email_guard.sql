-- 108: Guard anti-duplicados del email de Garantía de Nivel
--
-- Caso Javier 2026-08-06: recibió 3 veces el email de la garantía
-- porque cada re-emisión del certificado (para corregir fechas)
-- volvía a enviar, y el borrado del cert perdía el rastro del envío.
--
-- El flag vive en students (sobrevive a borrados/re-emisiones del
-- certificado): si está seteado, NINGÚN camino vuelve a enviar el
-- email salvo force_email explícito del admin.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS garantia_email_sent_at TIMESTAMPTZ;

-- Backfill: los 3 que ya lo recibieron (Nancy, Flora, Javier)
UPDATE students SET garantia_email_sent_at = NOW()
WHERE id IN (
  SELECT student_id FROM certificates WHERE type = 'garantia_nivel'
);
