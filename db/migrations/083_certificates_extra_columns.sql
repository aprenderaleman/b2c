-- =============================================================================
-- Migration 083 — certificates: extra columns + level_a1 enum value
-- =============================================================================
BEGIN;

-- Add level_a1 to the certificate_type enum
ALTER TYPE certificate_type ADD VALUE IF NOT EXISTS 'level_a1' BEFORE 'level_a2';

COMMIT;

-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in some PG versions,
-- so we commit above and start a new transaction for the column additions.
BEGIN;

ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS date_from     DATE,
  ADD COLUMN IF NOT EXISTS date_to       DATE,
  ADD COLUMN IF NOT EXISTS total_hours   INT,
  ADD COLUMN IF NOT EXISTS teacher_name  TEXT;

COMMIT;
