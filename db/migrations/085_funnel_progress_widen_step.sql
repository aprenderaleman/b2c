-- =============================================================================
-- Migration 085 — widen funnel_progress step CHECK constraint
-- =============================================================================
-- The original constraint (step BETWEEN 1 AND 7) blocks the granular
-- step codes 10-16 added by the Phase 2 funnel instrumentation.
-- All inserts from the landing/booking flow have been silently failing.
-- =============================================================================

BEGIN;

ALTER TABLE funnel_progress
  DROP CONSTRAINT IF EXISTS funnel_progress_step_check;

ALTER TABLE funnel_progress
  ADD CONSTRAINT funnel_progress_step_check CHECK (step BETWEEN 1 AND 999);

COMMIT;
