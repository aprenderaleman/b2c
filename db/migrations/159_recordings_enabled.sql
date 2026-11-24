-- 159: grabaciones por alumno (Bono de Acción Rápida, Gelfis 2026-11-26).
-- recordings_enabled=true → todas sus clases se graban desde hoy y ve la
-- página "Grabaciones" en su menú. Se activa automáticamente al ganar el
-- bono 48h (lead-conversion) o a mano desde admin. Retención: plan
-- activo + 30 días. Trials: se graban todas; si el lead no convierte,
-- su grabación se borra a los 14 días (cron recordings-retention).
alter table students add column if not exists recordings_enabled boolean not null default false;
