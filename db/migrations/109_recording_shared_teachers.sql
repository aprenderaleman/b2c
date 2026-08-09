-- 109: Compartir grabaciones de trials con el equipo de profesores
--
-- Petición Gelfis 2026-08-07: dar acceso a Simon y Sabine a la
-- grabación de su clase de prueba con Nancy (formación interna).
-- Las grabaciones de trials solo las ve superadmin + profe asignado;
-- este flag por-grabación abre el acceso a CUALQUIER profesor activo
-- logueado. Default off — se activa a mano por grabación.

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS shared_with_teachers BOOLEAN NOT NULL DEFAULT FALSE;
