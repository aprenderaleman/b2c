-- ============================================================
-- Migration 053 — Expand the german_level enum with sub-levels
-- so the drip's PDF gift can be targeted precisely.
--
-- Previously the enum had 4 coarse values: A0, A1-A2, B1, B2+.
-- That left the PDF library with two orphans (A1.2 and the
-- ungenerated B1/B2 detail) and made every A1-A2 lead receive
-- the same A1.1 PDF.
--
-- After this migration the enum supports 7 values:
--   A0, A1.1, A1.2, A2.1, A2.2, B1, B2
--
-- Legacy values 'A1-A2' and 'B2+' are KEPT for backwards-compat
-- — historical rows still have them and the funnel quiz may
-- continue to use them as fallback for leads who say
-- "no estoy seguro" or pick the coarse band. New funnel UI
-- writes the precise sub-level.
-- ============================================================

-- PostgreSQL does not allow ALTER TYPE … ADD VALUE inside a
-- transaction block in some clients. Each ADD must commit on its
-- own. Supabase's SQL editor handles this transparently; psql
-- needs each statement run one-by-one (or via psql -1).
ALTER TYPE german_level ADD VALUE IF NOT EXISTS 'A1.1';
ALTER TYPE german_level ADD VALUE IF NOT EXISTS 'A1.2';
ALTER TYPE german_level ADD VALUE IF NOT EXISTS 'A2.1';
ALTER TYPE german_level ADD VALUE IF NOT EXISTS 'A2.2';
ALTER TYPE german_level ADD VALUE IF NOT EXISTS 'B2';
