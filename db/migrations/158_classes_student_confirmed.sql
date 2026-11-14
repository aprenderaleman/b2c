-- 158_classes_student_confirmed.sql
-- Confirmación de asistencia por el lead (Gelfis 2026-11-14).
--
-- Flujo: el setter marca "Confirmado" en el panel, o el lead pulsa el
-- botón "Confirmar mi clase" desde el WA/email que recibe tras un
-- "No contestó". Queremos que el profe vea en su panel si el lead ya
-- confirmó su clase (reduce no-shows y da info al profe para priorizar
-- en qué lead invertir prep).
--
-- Columnas:
--   student_confirmed_at     — timestamp de la confirmación (NULL = sin
--                              confirmar). Idempotente: una vez seteado
--                              no se sobrescribe.
--   student_confirmed_source — 'setter_phone' | 'student_web' | 'student_wa_reply'
--                              (fuente: llamada del setter que confirmó
--                              verbalmente, click del lead en el botón,
--                              o respuesta "Sí/CONFIRMO" al WA).

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS student_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS student_confirmed_source text;

-- Índice parcial: la query del panel del profe filtra por is_trial +
-- scheduled_at + confirmado. Pequeño porque solo indexa las trials
-- confirmadas (la mayoría).
CREATE INDEX IF NOT EXISTS idx_classes_student_confirmed
  ON classes (scheduled_at)
  WHERE student_confirmed_at IS NOT NULL;

COMMENT ON COLUMN classes.student_confirmed_at IS
  'Cuándo el lead/estudiante confirmó asistencia (setter, botón web o reply WA). Visible al profe.';
COMMENT ON COLUMN classes.student_confirmed_source IS
  'setter_phone | student_web | student_wa_reply';
