-- =============================================================================
-- Migration 033 — allow a student group to span multiple CEFR levels
-- =============================================================================
-- Some groups (mixed-level beginner cohorts, exam-prep pools) actually
-- straddle 2-3 levels. A single `level cefr_level` column can't express
-- that, so we add `levels cefr_level[]` alongside. Existing rows get
-- back-filled to a single-element array so the UI renders consistently.
--
-- We KEEP the original `level` column for now to avoid breaking any
-- lingering query that still references it — it just stops being the
-- source of truth. A future migration can drop it once we've verified
-- nothing reads it.
-- =============================================================================

BEGIN;

ALTER TABLE student_groups
    ADD COLUMN IF NOT EXISTS levels cefr_level[];

-- Back-fill: existing groups that have a single level become a one-item array.
UPDATE student_groups
   SET levels = ARRAY[level]::cefr_level[]
 WHERE level IS NOT NULL AND (levels IS NULL OR cardinality(levels) = 0);

COMMENT ON COLUMN student_groups.levels IS
    'Array of CEFR levels the group spans. Replaces the singular `level`. Empty/NULL = "not level-tagged".';

-- Helper index for filtering groups that include a given level.
CREATE INDEX IF NOT EXISTS student_groups_levels_gin_idx
    ON student_groups USING GIN (levels);

COMMIT;
