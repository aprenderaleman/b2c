-- 121_teacher_reminded_at.sql
--
-- Añade `students.teacher_reminded_at` para dedupe del cron
-- teacher-contact-timeout (Gelfis 2026-08-26).
--
-- Bug reportado: el cron corría cada hora, y en la ventana 24-48h post
-- assignment enviaba WA + notif in-app al profe EN CADA TICK sin
-- verificar si ya se había recordado. Hasta ~24 recordatorios idénticos
-- por student. Con este flag, el cron manda máximo 1 recordatorio.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS teacher_reminded_at TIMESTAMPTZ;

COMMENT ON COLUMN students.teacher_reminded_at IS
  'Cuando el cron teacher-contact-timeout envió el aviso 24h al profe. '
  'NULL si aún no se avisó. Se resetea al reasignar profe.';
