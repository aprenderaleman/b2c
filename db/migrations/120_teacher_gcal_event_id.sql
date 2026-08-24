-- 120: espejo de clases en el Google Calendar personal del profe.
--
-- Hasta ahora solo las clases de prueba se creaban en el GCal del profe
-- (book-trial → createTeacherTrialEvent) y el event id NO se guardaba,
-- así que reagendar/cancelar nunca podía actualizar el evento. Esta
-- columna guarda el id del evento en el calendar del PROFE (OAuth,
-- teacher_google_credentials) — separada de google_calendar_event_id
-- (calendar central de Gelfis) y closer_gcal_event_id (closers).

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS teacher_gcal_event_id text;

COMMENT ON COLUMN classes.teacher_gcal_event_id IS
  'Event id en el Google Calendar personal del profesor asignado (OAuth). Null si el profe no tiene GCal vinculado o el evento aun no se ha espejado.';
