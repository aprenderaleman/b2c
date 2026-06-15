-- 063_trial_attendance_timestamps.sql
--
-- Source-of-truth columnas para medir asistencia a clase de prueba.
-- Hasta ahora `/admin/ads` calculaba attended/absent con substring
-- matching contra `lead_timeline.content`:
--
--   .ilike('content', '%attended trial%')
--   .ilike('content', '%did not attend trial%')
--
-- Esto es frágil (cualquier cambio de copy rompe el dashboard) y
-- además no permite filtrar por ventana temporal sin pasar por la
-- timeline. Movemos la verdad a `leads`:
--
--   - `trial_attended_at` ← timestamp cuando el profe marca asistió
--   - `trial_absent_at`   ← timestamp cuando el profe marca no asistió
--                            (o cuando el cron auto-mark lo cierra)
--
-- Las columnas son TIMESTAMPTZ NULLABLE; coexisten con `leads.status`
-- (`trial_attended` / `trial_absent`). El status sigue siendo la
-- bandera lógica; el timestamp permite agregar por ventana.
--
-- BACKFILL: rellenamos desde lead_timeline existente leyendo el
-- primer evento `attended trial` / `did not attend trial` por lead.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS trial_attended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_absent_at   TIMESTAMPTZ;

-- Backfill attended desde lead_timeline (primer evento por lead)
UPDATE leads l
SET trial_attended_at = sub.first_at
FROM (
  SELECT lead_id, MIN(timestamp) AS first_at
  FROM lead_timeline
  WHERE type = 'status_change'
    AND content ILIKE '%attended trial%'
    AND content NOT ILIKE '%did not attend%'
  GROUP BY lead_id
) sub
WHERE l.id = sub.lead_id
  AND l.trial_attended_at IS NULL;

-- Backfill absent
UPDATE leads l
SET trial_absent_at = sub.first_at
FROM (
  SELECT lead_id, MIN(timestamp) AS first_at
  FROM lead_timeline
  WHERE type = 'status_change'
    AND content ILIKE '%did not attend trial%'
  GROUP BY lead_id
) sub
WHERE l.id = sub.lead_id
  AND l.trial_absent_at IS NULL;

-- Índices para los KPIs de /admin/ads (filtros por ventana temporal)
CREATE INDEX IF NOT EXISTS idx_leads_trial_attended_at
  ON leads (trial_attended_at)
  WHERE trial_attended_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_trial_absent_at
  ON leads (trial_absent_at)
  WHERE trial_absent_at IS NOT NULL;

COMMENT ON COLUMN leads.trial_attended_at IS
  'Timestamp cuando el lead asistió a su clase de prueba. Fuente de verdad para la métrica de asistencia (antes era substring match en lead_timeline). Set por markTrialAttendedAwaitingConversion().';

COMMENT ON COLUMN leads.trial_absent_at IS
  'Timestamp cuando se confirmó que el lead NO asistió a su clase de prueba. Set por markTrialAbsent() (manual del profe) o por el cron auto-absent (trials con scheduled_at + 24h sin resolución).';

COMMIT;
