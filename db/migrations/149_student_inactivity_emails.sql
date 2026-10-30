-- 149: Emails automáticos de reactivación a alumnos sin clases (Gelfis
-- 2026-10-30). Umbrales: 7 días sin primera clase, 14 y 30 días sin clase
-- completada (sin ninguna agendada). Un email por umbral y por racha: la
-- racha se identifica por la última clase completada (last_class_at).
-- Lógica en web/lib/student-inactivity.ts, cron /api/cron/student-inactivity.

CREATE TABLE IF NOT EXISTS student_inactivity_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('never_started_7','inactive_14','inactive_30')),
  last_class_at timestamptz,            -- NULL = nunca tuvo clase
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_inactivity_emails_student_idx
  ON student_inactivity_emails(student_id, kind, sent_at DESC);
