-- 060_notifications.sql
--
-- Notificaciones in-app para Gelfis (rol superadmin). Centraliza alertas
-- operativas del sistema en un solo sitio: pausas automáticas, recoveries
-- post-incidente, leads que se quedaron sin respuesta, escalations a
-- needs_human, etc.
--
-- UI: NotificationBell en el header del admin shell, badge con contador
-- de unread, dropdown con lista. Endpoint REST simple para list/mark-read.

BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tipo categórico para que la UI pueda filtrar/colorear.
  -- Mismo set de kinds que ya usamos en lead_timeline.metadata.kind
  -- + algunos nuevos específicos de operación.
  type         text        NOT NULL,
  -- Severidad: visual + filtrado. 'critical' siempre se muestra.
  severity     text        NOT NULL CHECK (severity IN ('info','warning','critical')),
  title        text        NOT NULL,           -- línea corta para el bell
  body         text,                            -- detalle expandido
  -- Lead/recurso al que apunta (opcional). Si está, la UI ofrece "Ir al lead".
  lead_id      uuid        REFERENCES leads(id) ON DELETE SET NULL,
  -- URL relativa de acción rápida. Ej. /admin/leads/{id} o /admin/system.
  action_url   text,
  -- Metadata libre por type. Útil para debug.
  metadata     jsonb,
  -- Estado del read. NULL = no leído.
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_recent_idx
  ON notifications (created_at DESC);

COMMIT;
