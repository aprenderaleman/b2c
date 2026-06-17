-- Migration 068: admin_notifications
--
-- Bug descubierto 2026-06-17: la migration 060_notifications.sql intentó
-- crear una tabla `notifications` para Gelfis (severity/lead_id/action_url
-- /metadata) pero falló silenciosamente porque ya existía una tabla
-- `notifications` distinta de migration 013 (per-user/class reminders
-- de profesores con user_id NOT NULL).
--
-- Resultado: createAdminNotification (web/lib/admin-notifications.ts)
-- ha estado fallando silenciosamente en TODAS sus inserts. Ninguna
-- alerta admin (system_paused_auto, system_resumed_auto, recovery,
-- ahora messaging_health_daily) ha llegado al panel de Gelfis.
--
-- Fix: crear tabla nueva con nombre `admin_notifications` para no
-- chocar con la legacy. El code de admin-notifications.ts apunta a
-- esta nueva tabla.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text        NOT NULL,
  severity     text        NOT NULL CHECK (severity IN ('info','warning','critical')),
  title        text        NOT NULL,
  body         text,
  lead_id      uuid        REFERENCES leads(id) ON DELETE SET NULL,
  action_url   text,
  metadata     jsonb,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_notifications_unread_idx
  ON admin_notifications (created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_notifications_recent_idx
  ON admin_notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_type_idx
  ON admin_notifications (type, created_at DESC);

COMMENT ON TABLE admin_notifications IS
  'In-app alerts para superadmin (Gelfis). Distinta de la tabla notifications '
  'legacy que es para reminders de clase de profesores.';

COMMIT;
