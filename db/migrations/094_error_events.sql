-- Tabla ligera para persistir errores server-side hasta que se
-- instale Sentry (Gelfis 2026-07-28). Opcional — reportError()
-- ya loguea a Vercel; esta tabla permite consultar desde /admin
-- sin ir a la UI de Vercel.

CREATE TABLE IF NOT EXISTS error_events (
  id          BIGSERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  message     TEXT NOT NULL,
  stack       TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_events_created_at_desc
  ON error_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_endpoint
  ON error_events(endpoint);
