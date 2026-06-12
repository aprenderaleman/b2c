-- Migration 054: atribución de trial → estudiante convertido
--
-- Cuando un lead asiste a su clase de prueba y luego se convierte a
-- estudiante, queremos saber QUÉ profesor le dio el trial para:
--   (a) Calcular su tasa de conversión (trials dados → conversiones).
--   (b) Pagarle la comisión por cierre (50/80/100/200€ según pack).
--
-- Hasta ahora la conexión se perdía: la clase trial tenía teacher_id
-- pero al convertir no copiábamos nada a la fila del student. Esta
-- migración añade 2 columnas en students para guardar la atribución
-- explícita.

BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS trial_teacher_id UUID NULL REFERENCES teachers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trial_class_id   UUID NULL REFERENCES classes(id)  ON DELETE SET NULL;

-- Index para consultas "cuántos alumnos convertí" por profe.
CREATE INDEX IF NOT EXISTS idx_students_trial_teacher
  ON students(trial_teacher_id)
  WHERE trial_teacher_id IS NOT NULL;

COMMENT ON COLUMN students.trial_teacher_id IS
  'Profesor que dió la clase de prueba a este lead antes de convertirlo. Usado para tasa de conversión + comisión.';
COMMENT ON COLUMN students.trial_class_id IS
  'Clase de prueba específica de la que viene este estudiante. FK a classes(is_trial=true).';

COMMIT;
