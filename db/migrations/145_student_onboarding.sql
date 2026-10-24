-- 145: onboarding de alumnos y profes (Gelfis 2026-10-24): tour guiado +
-- lista "Primeros pasos". Eventos con timestamp ISO en un jsonb:
--   tour_seen, tour_dismissed, checklist_dismissed, y los pasos que no se
--   pueden deducir de otros datos (cursos, schule, hans, asistente…).
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS onboarding JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS onboarding JSONB NOT NULL DEFAULT '{}'::jsonb;
