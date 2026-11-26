-- 165_comision_pct_acordada.sql
-- Comisión acordada libre por profesor (Gelfis 2026-11-26).
--
-- Hasta ahora la comisión del profe salía solo de su rango
-- (config_rangos: starter 5 · pro 10 · elite 12 · master 15). Al invitar a
-- un profe nuevo se acuerdan porcentajes que no coinciden con ningún rango
-- (p. ej. 8 %), así que hace falta un campo de número libre.
--
--   teacher_invitations.comision_pct → lo que se acuerda al invitar.
--   users.comision_pct               → comisión acordada del profe. Si no es
--                                       NULL, MANDA sobre el rango en el motor
--                                       de comisiones (lib/teacher-commission.ts).
--
-- NULL = sin acuerdo particular: se sigue usando el rango, como siempre.

ALTER TABLE teacher_invitations
  ADD COLUMN IF NOT EXISTS comision_pct NUMERIC(5,2)
    CHECK (comision_pct IS NULL OR (comision_pct >= 0 AND comision_pct <= 100));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS comision_pct NUMERIC(5,2)
    CHECK (comision_pct IS NULL OR (comision_pct >= 0 AND comision_pct <= 100));

COMMENT ON COLUMN teacher_invitations.comision_pct IS
  'Comisión (%) acordada al invitar al profe. NULL = la del rango.';
COMMENT ON COLUMN users.comision_pct IS
  'Comisión (%) acordada con el profe. Si no es NULL manda sobre config_rangos (rango).';
