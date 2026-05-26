-- 054_funnel_progress.sql
-- Telemetría granular del funnel diagnóstico. Cada vez que un visitante
-- avanza un paso (clickea un motivo, elige un nivel, etc.) escribimos
-- una fila en funnel_progress con su session_id. Si abandona antes del
-- paso 5 (captura de datos), igual sabemos hasta dónde llegó.
--
-- Diseñado para alimentar /admin/ads — el dashboard de optimización
-- del funnel (cuello de botella + qué opción es más popular por paso).
--
-- Limpieza: filas con session_id huérfano (>30 días sin completar a
-- lead) se purgan en cron mensual.

CREATE TABLE IF NOT EXISTS funnel_progress (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT      NOT NULL,
  step        SMALLINT  NOT NULL CHECK (step BETWEEN 1 AND 7),
  -- Texto literal de la opción escogida (motivo, nivel, goal, urgency,
  -- budget). NULL para pasos que no son selección única (e.g., paso 5
  -- de captura — la "respuesta" es haber enviado el form).
  answer      TEXT,
  -- Útil para depurar y detectar bots / sesiones rotas.
  user_agent  TEXT,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_progress_session_idx
  ON funnel_progress (session_id, step);
CREATE INDEX IF NOT EXISTS funnel_progress_created_idx
  ON funnel_progress (created_at DESC);
CREATE INDEX IF NOT EXISTS funnel_progress_step_idx
  ON funnel_progress (step, created_at DESC);

-- Garantiza idempotencia: si el cliente reintenta (network blip, etc.)
-- no duplicamos la fila del mismo paso para la misma sesión.
CREATE UNIQUE INDEX IF NOT EXISTS funnel_progress_unique_step
  ON funnel_progress (session_id, step);
