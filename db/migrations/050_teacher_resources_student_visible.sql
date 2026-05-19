-- ============================================================
-- 050 — teacher_resources: flag student_visible
-- ============================================================
-- Cuando un profesor sube un recurso (típicamente video_link o
-- source_link) puede marcarlo "visible para alumnos". Los alumnos
-- los ven en /estudiante/biblioteca filtrados por su nivel.
--
-- Por defecto false: la biblioteca para profes sigue siendo privada.
-- ============================================================

ALTER TABLE teacher_resources
  ADD COLUMN IF NOT EXISTS student_visible BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS teacher_resources_student_visible_idx
  ON teacher_resources(student_visible) WHERE student_visible = true;

COMMENT ON COLUMN teacher_resources.student_visible IS
  'Si true, los alumnos lo ven en /estudiante/biblioteca filtrado por su nivel.';
