-- 150_users_iban.sql
-- IBAN para staff SIN tabla de perfil propia (setters; los profes ya lo
-- tienen en teachers.iban). Lo rellena el propio setter desde
-- /setter/perfil y lo lee el admin en /admin/setters/[id] para pagarle
-- (Gelfis 2026-11-02).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS iban TEXT;

COMMENT ON COLUMN users.iban IS
  'IBAN para pagos de staff sin tabla de perfil (setters). Profes: teachers.iban.';

COMMIT;
