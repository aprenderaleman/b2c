-- funnel_progress retention policy — 2026-07-28
--
-- La tabla crece rápido (~60/min/IP × N landings × N leads). Ya son
-- ~500k rows en 2 meses y sin retention. Aplicamos:
--
--   · Índice adicional sobre created_at DESC (si no existe) para que
--     el DELETE por rango sea barato.
--   · Retention: el cron /api/cron/funnel-progress-retention borra
--     semanalmente filas más viejas que 90 días (ver route.ts).
--
-- No hacemos partition ahora (Postgres partitioning es más
-- complicado en Supabase y no vale la pena hasta 5M+ rows). Si
-- crecemos más, la mejora es table_partition_by_range(created_at).

CREATE INDEX IF NOT EXISTS idx_funnel_progress_created_at_desc
  ON funnel_progress(created_at DESC);
