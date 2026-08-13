-- ============================================================
-- 106: Sesión de Plan — booking (fase 1, paso 2)
--
-- 1. tareas_closer.tipo acepta 'sesion_plan': la tarea que ancla la
--    sesión en la cola HOY del closer (semáforo la pone 🟡 el día y
--    🔴 pasada la hora sin registrar).
-- 2. leads.sesion_plan_at: los leads que agendan Sesión de Plan pueden
--    NO tener trial — la regla de visibilidad del closer (solo
--    post-trial) se amplía a "post-trial O con sesión agendada".
-- ============================================================

BEGIN;

ALTER TABLE tareas_closer DROP CONSTRAINT IF EXISTS tareas_closer_tipo_check;
ALTER TABLE tareas_closer ADD CONSTRAINT tareas_closer_tipo_check
  CHECK (tipo IN (
    'tipo_a', 'tipo_b',
    'seguimiento_post', 'llamada_rescate', 'llamada_objecion',
    'seguimiento_absent', 'inbound_response', 'reactivacion',
    'seguimiento_fecha', 'llamada_post_venta',
    'sesion_plan'
  ));

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS sesion_plan_at TIMESTAMPTZ;

COMMIT;
