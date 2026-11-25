-- ─────────────────────────────────────────────────────────────────────────
-- 164: CRM del Closer F5 — tipo de tarea 'llamada_24h'
-- (Gelfis 2026-11-25). El cron closer-llamada-24h crea "Llamar a [lead]"
-- a las 24h de un trial asistido sin pago; vence al terminar el bono
-- (asistencia + 48h, decisión B de Gelfis).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE tareas_closer DROP CONSTRAINT IF EXISTS tareas_closer_tipo_check;
ALTER TABLE tareas_closer ADD CONSTRAINT tareas_closer_tipo_check CHECK (
  tipo = ANY (ARRAY[
    'tipo_a'::text, 'tipo_b'::text, 'seguimiento_post'::text,
    'llamada_rescate'::text, 'llamada_objecion'::text,
    'seguimiento_absent'::text, 'inbound_response'::text,
    'reactivacion'::text, 'seguimiento_fecha'::text,
    'llamada_post_venta'::text, 'sesion_plan'::text,
    'auto_seguimiento'::text, 'llamada_24h'::text
  ])
);
