-- 101: Fixes priorizados del sistema profesor-estudiante
-- 1. Notas del profe por clase regular
-- 2. Garantía de nivel (attendance_rate + schule_completion)
-- 3. Alertas de retención al profe
-- 4. Soporte para reasignación de profesor

BEGIN;

-- =============================================================================
-- Fix 5: Notas por clase regular
-- =============================================================================
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS teacher_notes TEXT,
  ADD COLUMN IF NOT EXISTS notes_shared_with_student BOOLEAN NOT NULL DEFAULT FALSE;

-- =============================================================================
-- Fix 1: Motor de la Garantía de Nivel
-- =============================================================================
-- Cached metrics recalculated by cron or on-demand
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS attendance_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS schule_completion_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS garantia_status TEXT NOT NULL DEFAULT 'active'
    CHECK (garantia_status IN ('active', 'at_risk', 'lost', 'not_applicable'));

-- =============================================================================
-- Fix 2: Alertas de retención — nuevos tipos de notificación
-- (no schema change needed, just new notification types in code)
-- =============================================================================

-- =============================================================================
-- Fix 6: Reasignación de profesor — log de cambios
-- =============================================================================
CREATE TABLE IF NOT EXISTS teacher_reassignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  old_teacher_id UUID REFERENCES teachers(id),
  new_teacher_id UUID NOT NULL REFERENCES teachers(id),
  reason TEXT,
  reassigned_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
