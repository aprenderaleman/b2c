-- 100_conversion_e2_e3.sql
-- Phase 6: E2/E3 conversion tracking + teacher assignment columns

BEGIN;

-- 1. Teacher assignment tracking on students
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS teacher_assignment_source TEXT
    CHECK (teacher_assignment_source IS NULL OR teacher_assignment_source IN (
      'trial_teacher', 'auto_assigned', 'admin_manual', 'reassigned'
    )),
  ADD COLUMN IF NOT EXISTS teacher_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS teacher_contact_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS teacher_contacted_at TIMESTAMPTZ;

-- 2. Conversion scenario on ofertas_enviadas for traceability
ALTER TABLE ofertas_enviadas
  ADD COLUMN IF NOT EXISTS escenario TEXT
    CHECK (escenario IS NULL OR escenario IN ('E1', 'E2', 'E3'));

-- 3. Add notification type for student_converted
-- (notifications.type is TEXT without CHECK, so no migration needed)

COMMIT;
