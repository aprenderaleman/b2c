-- 043_classes_google_calendar.sql
--
-- Vincula una clase con su evento espejo en el Google Calendar de
-- Gelfis (cuenta personal aprenderaleman2026@gmail.com). Cuando la
-- clase se cancela / reagenda, podemos eliminar o actualizar el
-- evento usando este id. Nullable: si la integración no está
-- configurada o el create event falló, la columna queda en NULL —
-- la clase sigue funcionando con sus recordatorios propios.

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS google_calendar_event_id text;

COMMENT ON COLUMN classes.google_calendar_event_id IS
  'ID del evento espejo en Google Calendar (Service Account). NULL si la integración está deshabilitada o el create event falló — no bloqueante.';
