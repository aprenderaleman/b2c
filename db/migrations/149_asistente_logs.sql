-- 149: Registro de uso del Asistente IA (Gelfis 2026-10-30).
-- Una fila por turno. Solo visible para admin en /admin/asistente; se borra
-- a los 90 días desde el cron queue-cleanup. sin_resolver lo marca el propio
-- asistente (herramienta registrar_no_resuelto).

CREATE TABLE IF NOT EXISTS asistente_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL,
  pregunta      text NOT NULL,
  respuesta     text,
  herramientas  jsonb NOT NULL DEFAULT '[]'::jsonb,
  acciones      jsonb NOT NULL DEFAULT '[]'::jsonb,
  sin_resolver  text,
  input_tokens  int,
  output_tokens int,
  cache_tokens  int,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asistente_logs_created_idx ON asistente_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS asistente_logs_sin_resolver_idx ON asistente_logs(created_at DESC) WHERE sin_resolver IS NOT NULL;
ALTER TABLE asistente_logs ENABLE ROW LEVEL SECURITY;
