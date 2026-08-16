-- ============================================================
-- 114: tareas_closer.tipo acepta 'auto_seguimiento'
--
-- Regla anti-limbo del semáforo global (fase 2, spec Gelfis
-- 2026-08-16): al guardar cualquier acción, si el lead queda sin
-- tarea futura ni cadena activa, el sistema crea una auto-tarea
-- "Seguimiento" a +3 días. Tipo propio para que el trace y el
-- tablero distingan las tareas creadas por la regla de las del
-- motor de cadencia.
-- ============================================================

BEGIN;

ALTER TABLE tareas_closer DROP CONSTRAINT IF EXISTS tareas_closer_tipo_check;
ALTER TABLE tareas_closer ADD CONSTRAINT tareas_closer_tipo_check
  CHECK (tipo IN (
    'tipo_a', 'tipo_b',
    'seguimiento_post', 'llamada_rescate', 'llamada_objecion',
    'seguimiento_absent', 'inbound_response', 'reactivacion',
    'seguimiento_fecha', 'llamada_post_venta',
    'sesion_plan',
    'auto_seguimiento'
  ));

COMMIT;
