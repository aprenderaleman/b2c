-- ============================================================
-- 115: lead_contacts — permitir cascadas del sistema
--
-- El trigger de inmutabilidad (113) bloqueaba TAMBIÉN:
--   · DELETE en cascada al borrar un lead (derecho GDPR al olvido
--     — el botón "Borrar" de /admin/leads/[id] fallaría)
--   · UPDATE SET NULL de timeline_id al borrar filas de lead_timeline
--
-- Fix: dentro de una cascada de FK, pg_trigger_depth() > 1 (el
-- trigger RI interno ya está en ejecución). Un UPDATE/DELETE directo
-- entra con depth = 1 y sigue bloqueado. La inmutabilidad frente a
-- humanos y código de aplicación queda intacta.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION lead_contacts_immutable()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    -- Cascada del sistema (borrado GDPR del lead / SET NULL de
    -- timeline_id): permitida.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'lead_contacts es inmutable: los registros no se editan ni borran (corrección = nuevo registro con nota)';
END;
$$ LANGUAGE plpgsql;

COMMIT;
