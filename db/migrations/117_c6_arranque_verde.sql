-- ============================================================
-- 117: C6 — arranque en verde del semáforo global
--
-- Spec (Gelfis 2026-08-16, check C6): "todos los leads activos
-- existentes reciben auto-tarea de revisión a +3 días (arrancan
-- verdes, no rojos — evitar un muro de 200 rojos falsos el día 1
-- que mate la credibilidad del sistema)".
--
-- La primera pasada del observador confirmó el muro: 219 rojos de
-- deuda histórica. Dos movimientos, ambos transparentes:
--
--   1. Las tareas pendientes VENCIDAS (due < hoy Berlín) de leads
--      activos se archivan con marca [C6] en notas — no se borran,
--      no se inventan resultados. Apaga los R2 históricos.
--   2. Todo lead activo con closer que quede sin jugada futura
--      (sin tarea futura ni cadena activa) recibe la auto-tarea
--      "Revisión (arranque semáforo)" a +3 días 10:00 Berlín.
--
-- Los R1/R3/R4/R5 históricos los apaga el epoch en código
-- (SEMAFORO_EPOCH, lib/semaforo.ts): disparadores anteriores al
-- 2026-08-17 00:00 Berlín no generan rojo. La deuda empieza a
-- contar desde el arranque.
-- ============================================================

BEGIN;

-- 1. Archivar tareas vencidas históricas de leads activos
UPDATE tareas_closer t
SET fecha_completada = now(),
    notas = trim(coalesce(t.notas, '') || ' [C6: archivada en el arranque del semáforo global 2026-08-17]')
WHERE t.fecha_completada IS NULL
  AND t.fecha_programada < (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')
  AND EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = t.lead_id
      AND coalesce(l.estado_cierre, '') NOT IN ('perdido', 'convertido')
      AND l.status NOT IN ('lost', 'converted')
  );

-- 2. Auto-tarea de revisión +3d para activos sin jugada
INSERT INTO tareas_closer (closer_id, lead_id, paso, tipo, canal, plantilla, fecha_programada)
SELECT
  l.closer_id, l.id, 99, 'auto_seguimiento', 'whatsapp',
  'Revisión (arranque semáforo global)',
  (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') + interval '3 days 10 hours') AT TIME ZONE 'Europe/Berlin'
FROM leads l
WHERE l.closer_id IS NOT NULL
  AND coalesce(l.estado_cierre, '') NOT IN ('perdido', 'convertido', 'en_reactivacion')
  AND l.status NOT IN ('lost', 'converted')
  AND NOT EXISTS (
    SELECT 1 FROM tareas_closer t
    WHERE t.lead_id = l.id AND t.fecha_completada IS NULL AND t.fecha_programada > now()
  )
  AND NOT EXISTS (
    SELECT 1 FROM lead_chains c
    WHERE c.lead_id = l.id AND c.completed_at IS NULL
  );

COMMIT;
