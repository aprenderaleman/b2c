-- ============================================================
-- 047 — RPCs para el cron de detección de anomalías
-- ============================================================
-- Estas funciones son consumidas por
-- /api/cron/data-integrity-check para localizar:
--   · Filas en class_participants con clase ANTERIOR al joined_at
--     del alumno en el grupo (bug del backfill de Zoom).
--   · Backfills masivos: ≥5 class_participants creadas en un solo
--     día con scheduled_at en el pasado lejano.
-- Solo lectura. Sin efectos secundarios.
-- ============================================================

CREATE OR REPLACE FUNCTION data_integrity_phantom_membership()
RETURNS TABLE (
  student_email      text,
  student_name       text,
  group_name         text,
  member_joined_at   timestamptz,
  n_phantom_classes  bigint,
  earliest_phantom   timestamptz,
  latest_phantom     timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    u.email::text,
    u.full_name::text,
    sg.name::text,
    sgm.joined_at,
    COUNT(*),
    MIN(c.scheduled_at),
    MAX(c.scheduled_at)
   FROM class_participants cp
   JOIN classes c            ON c.id = cp.class_id
   JOIN students st          ON st.id = cp.student_id
   JOIN users u              ON u.id = st.user_id
   JOIN student_group_members sgm
     ON sgm.student_id = cp.student_id AND sgm.group_id = c.group_id
   JOIN student_groups sg    ON sg.id = c.group_id
  WHERE c.scheduled_at < sgm.joined_at
    AND c.is_trial = false
    -- Solo flageamos filas creadas en los últimos 7 días para evitar
    -- repetir alarmas sobre bugs históricos ya conciliados.
    AND cp.created_at >= NOW() - INTERVAL '7 days'
  GROUP BY u.email, u.full_name, sg.name, sgm.joined_at
  ORDER BY COUNT(*) DESC;
$$;

COMMENT ON FUNCTION data_integrity_phantom_membership IS
  'Detecta filas en class_participants con clase anterior al joined_at del alumno (bug del backfill).';

CREATE OR REPLACE FUNCTION data_integrity_bulk_backfill()
RETURNS TABLE (
  student_email   text,
  student_name    text,
  dia_creacion    date,
  n_pasadas       bigint,
  earliest        timestamptz,
  latest_past     timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH bulk AS (
    SELECT
      cp.student_id,
      date_trunc('day', cp.created_at)::date AS dia,
      COUNT(*) FILTER (WHERE c.scheduled_at < cp.created_at - INTERVAL '7 days') AS pasadas,
      MIN(c.scheduled_at) AS earliest,
      MAX(c.scheduled_at) FILTER (WHERE c.scheduled_at < cp.created_at - INTERVAL '7 days') AS latest_past
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
    WHERE c.is_trial = false
      -- Solo backfills creados en los últimos 7 días (alarmas accionables).
      AND cp.created_at >= NOW() - INTERVAL '7 days'
    GROUP BY cp.student_id, date_trunc('day', cp.created_at)
    HAVING COUNT(*) FILTER (WHERE c.scheduled_at < cp.created_at - INTERVAL '7 days') >= 5
  )
  SELECT u.email::text, u.full_name::text, b.dia, b.pasadas, b.earliest, b.latest_past
    FROM bulk b
    JOIN students st ON st.id = b.student_id
    JOIN users u    ON u.id = st.user_id
   ORDER BY b.pasadas DESC;
$$;

COMMENT ON FUNCTION data_integrity_bulk_backfill IS
  'Detecta backfills masivos: ≥5 class_participants creadas en un solo día con scheduled_at en pasado lejano.';
