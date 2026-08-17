-- 088_no_double_booking.sql
-- Previene que un profesor tenga dos clases solapadas.
--
-- Estrategia: función + constraint CHECK no son suficientes para rangos
-- temporales en Supabase (no soporta EXCLUDE con btree_gist en todas las
-- instancias). En su lugar usamos un UNIQUE parcial sobre
-- (teacher_id, scheduled_at) para clases activas. Esto cubre el caso
-- exacto (dos clases a la MISMA hora); para solapamientos parciales
-- (e.g. clase de 60min que empieza 30min antes) el check se hace en
-- la app con listTrialSlots() y el race-guard del reschedule.
--
-- El unique index solo aplica a clases no-borradas y con status activo.

CREATE UNIQUE INDEX IF NOT EXISTS classes_no_double_booking_uidx
  ON classes (teacher_id, scheduled_at)
  WHERE deleted_at IS NULL
    AND status IN ('scheduled', 'live');
