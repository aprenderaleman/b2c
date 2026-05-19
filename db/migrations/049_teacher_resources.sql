-- ============================================================
-- 049 — Biblioteca de recursos compartida entre profesores
-- ============================================================
-- Cualquier profesor puede subir un recurso (PDF, doc, enlace a vídeo
-- o enlace a fuente externa) y todos los demás profesores lo ven y
-- pueden usarlo. Diferente de la tabla `materials` que es personal
-- del profe y se comparte sólo con sus propios alumnos.
-- ============================================================

CREATE TABLE IF NOT EXISTS teacher_resources (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  uploaded_by         UUID NOT NULL REFERENCES teachers(id) ON DELETE SET NULL,
  title               VARCHAR(200) NOT NULL,
  description         TEXT,

  -- Clasificación para filtrar
  level               VARCHAR(2)  NOT NULL,  -- A0, A1, A2, B1, B2, C1, C2 o 'XX' (todos)
  topic               VARCHAR(80) NOT NULL,  -- p.ej. "gramática", "vocabulario", "cultura", "ejercicios"

  -- Tipo del recurso
  kind                VARCHAR(20) NOT NULL,  -- pdf | doc | video_link | source_link

  -- Si es archivo subido (kind=pdf|doc): URL en R2 + tamaño
  file_url            TEXT,
  file_name           VARCHAR(255),
  file_size_bytes     BIGINT,
  storage_key         TEXT,

  -- Si es enlace externo (kind=video_link|source_link): la URL
  external_url        TEXT,

  -- Tags libres para búsqueda adicional
  tags                TEXT[] NOT NULL DEFAULT '{}',

  -- Contador de descargas/aperturas para ranking opcional
  open_count          INT NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE teacher_resources
  DROP CONSTRAINT IF EXISTS teacher_resources_level_check;
ALTER TABLE teacher_resources
  ADD CONSTRAINT teacher_resources_level_check
  CHECK (level IN ('A0','A1','A2','B1','B2','C1','C2','XX'));

ALTER TABLE teacher_resources
  DROP CONSTRAINT IF EXISTS teacher_resources_kind_check;
ALTER TABLE teacher_resources
  ADD CONSTRAINT teacher_resources_kind_check
  CHECK (kind IN ('pdf','doc','video_link','source_link'));

-- Coherencia: kind=archivo ⇒ file_url no null. kind=enlace ⇒ external_url no null.
ALTER TABLE teacher_resources
  DROP CONSTRAINT IF EXISTS teacher_resources_payload_check;
ALTER TABLE teacher_resources
  ADD CONSTRAINT teacher_resources_payload_check
  CHECK (
    (kind IN ('pdf','doc') AND file_url IS NOT NULL)
    OR
    (kind IN ('video_link','source_link') AND external_url IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS teacher_resources_level_idx     ON teacher_resources(level);
CREATE INDEX IF NOT EXISTS teacher_resources_kind_idx      ON teacher_resources(kind);
CREATE INDEX IF NOT EXISTS teacher_resources_uploaded_by_idx ON teacher_resources(uploaded_by);
CREATE INDEX IF NOT EXISTS teacher_resources_created_at_idx ON teacher_resources(created_at DESC);
CREATE INDEX IF NOT EXISTS teacher_resources_topic_trgm     ON teacher_resources USING GIN (topic gin_trgm_ops);
CREATE INDEX IF NOT EXISTS teacher_resources_title_trgm     ON teacher_resources USING GIN (title gin_trgm_ops);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_teacher_resources_updated_at ON teacher_resources;
CREATE TRIGGER trg_teacher_resources_updated_at
  BEFORE UPDATE ON teacher_resources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE teacher_resources IS
  'Biblioteca de recursos compartida entre profesores: PDFs, docs, enlaces a vídeos y fuentes externas. Cualquier profe sube, todos ven.';
