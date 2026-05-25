-- Migration 053: class_reviews
--
-- Captura reseñas de estudiantes activos justo después de una clase.
-- Una fila por (class_id, student_id) — se inserta cuando el estudiante
-- (a) deja rating + comentario, o (b) descarta el popup. Eso evita
-- volver a mostrarlo. Si NO existe fila para una clase atendida en
-- los últimos 7 días, /estudiante muestra el prompt no intrusivo.
--
-- Mantenemos rating NULL + dismissed_at NOT NULL para "skip" del
-- alumno, y rating 1..5 + dismissed_at NULL para reseña real.

BEGIN;

CREATE TABLE IF NOT EXISTS class_reviews (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      UUID         NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id    UUID         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  rating        SMALLINT     NULL CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  comment       TEXT         NULL,
  dismissed_at  TIMESTAMPTZ  NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, student_id)
);

-- Lookup: "¿qué reseñas tiene este profe en el último mes?"
CREATE INDEX IF NOT EXISTS idx_class_reviews_class_id    ON class_reviews(class_id);
CREATE INDEX IF NOT EXISTS idx_class_reviews_student_id  ON class_reviews(student_id);
CREATE INDEX IF NOT EXISTS idx_class_reviews_created_at  ON class_reviews(created_at DESC);

COMMENT ON TABLE  class_reviews IS 'Reseñas in-app de alumnos tras la clase (rating 1-5 + comentario opcional). Una fila por (clase, alumno).';
COMMENT ON COLUMN class_reviews.dismissed_at IS 'Set cuando el alumno descarta el popup sin puntuar — evita volver a mostrarlo.';

COMMIT;
