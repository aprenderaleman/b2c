-- ─────────────────────────────────────────────────────────────────────────
-- 163: CRM del Closer F1 — hora real del contacto en acciones_closer
-- (Gelfis 2026-11-25). La comisión del closer depende de que el contacto
-- quede registrado ANTES del pago, así que el closer puede indicar cuándo
-- ocurrió realmente el contacto (hasta 48h atrás, igual que lead_contacts).
-- created_at sigue siendo el momento del registro en el panel.
-- ─────────────────────────────────────────────────────────────────────────

-- Columna nullable primero + backfill, y luego default/NOT NULL: un ADD
-- COLUMN con DEFAULT now() pondría la hora de la migración en todo el
-- histórico.
ALTER TABLE acciones_closer ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
UPDATE acciones_closer SET occurred_at = created_at WHERE occurred_at IS NULL;
ALTER TABLE acciones_closer ALTER COLUMN occurred_at SET DEFAULT now();
ALTER TABLE acciones_closer ALTER COLUMN occurred_at SET NOT NULL;

-- El espejo a lead_contacts usa la hora real del contacto. Misma función
-- que 113 con un único cambio: occurred_at = COALESCE(NEW.occurred_at,
-- NEW.created_at).
CREATE OR REPLACE FUNCTION lead_contacts_mirror_accion()
RETURNS trigger AS $$
DECLARE
  v_action  TEXT;
  v_channel TEXT;
  v_name    TEXT;
BEGIN
  v_action := CASE NEW.tipo
    WHEN 'reagendado'       THEN 'agendar_prueba'
    WHEN 'no_contesto'      THEN 'no_contesto'
    WHEN 'buzon'            THEN 'no_contesto'
    WHEN 'venta'            THEN 'enviar_propuesta'
    WHEN 'mensaje_enviado'  THEN 'enviar_info'
    ELSE 'nota_libre'
  END;
  v_channel := CASE
    WHEN NEW.tipo IN ('llamada', 'buzon')             THEN 'llamada'
    WHEN NEW.tipo IN ('whatsapp', 'mensaje_enviado')  THEN 'whatsapp'
    WHEN NEW.tipo = 'email'                           THEN 'email'
    ELSE 'otro'
  END;
  SELECT full_name INTO v_name FROM users WHERE id = NEW.closer_id;

  INSERT INTO lead_contacts
    (lead_id, actor_type, actor_id, actor_name, direction, action_type, note,
     channel, occurred_at, source, legacy_accion_id)
  VALUES
    (NEW.lead_id, 'closer', NEW.closer_id, v_name, 'saliente', v_action,
     coalesce(nullif(trim(concat_ws(' — ', NEW.contenido, NEW.resultado,
                                    NEW.objection_chip, NEW.motivo_no_interesado)), ''), '(sin nota)'),
     v_channel, COALESCE(NEW.occurred_at, NEW.created_at), 'panel', NEW.id)
  ON CONFLICT (legacy_accion_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
