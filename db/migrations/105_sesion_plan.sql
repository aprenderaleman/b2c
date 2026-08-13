-- ============================================================
-- 105: Sesión de Plan — infraestructura (fase 1, paso 1)
--
-- Funnel /sesion-plan (Gelfis 2026-08-13): el lead agenda una
-- videollamada de 20 min con un CLOSER según closer_availability
-- (migración 104). La cita se modela como fila en `classes` con
-- `sesion_closer_id` como flag+anfitrión (is_trial=false,
-- teacher_id=null): reutiliza aula LiveKit, short_code y magic-link.
--
-- Decisiones fase 1:
--   · Slots cada 30 min en :00/:30, sesión de 20 min (colchón de
--     10 min para registrar en el CRM entre sesiones).
--   · Pool: closers con users.acepta_sesiones=true — grifo
--     INDEPENDIENTE de flujo_activo (cadencias). Un closer puede
--     pausar leads de cadencia y seguir aceptando sesiones o al revés.
-- ============================================================

BEGIN;

-- 1. Grifo de sesiones por closer (independiente de flujo_activo).
--    Default false: se enciende por closer desde /admin/closers.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS acepta_sesiones BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Anfitrión de la Sesión de Plan. NULL en todas las clases
--    normales; si está seteado, la fila ES una Sesión de Plan.
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS sesion_closer_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 3. Anti-double-booking del closer — gemelo del índice 088 de
--    profesores. Coincidencia exacta de scheduled_at; los solapes
--    parciales los evita la app (sesion-slots), igual que en trials.
CREATE UNIQUE INDEX IF NOT EXISTS classes_no_double_booking_closer_uidx
  ON classes (sesion_closer_id, scheduled_at)
  WHERE deleted_at IS NULL
    AND status IN ('scheduled', 'live')
    AND sesion_closer_id IS NOT NULL;

-- 4. Índice de lectura para el cálculo de ocupación y los crons.
CREATE INDEX IF NOT EXISTS idx_classes_sesion_closer
  ON classes (sesion_closer_id, scheduled_at)
  WHERE sesion_closer_id IS NOT NULL;

COMMIT;
