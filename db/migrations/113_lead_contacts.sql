-- =============================================================================
-- Migration 113 — lead_contacts: registro universal de contactos (fase 1)
-- =============================================================================
-- Spec "Sistema de estados globales" (Gelfis 2026-08-16), sección 2.
--
-- Una fila = un contacto real con el lead (saliente o entrante), venga de
-- donde venga: closer, profe, admin, Stiv (cadenas/crons) o el propio lead
-- (mensajes entrantes, pagos). Es la base del semáforo global (fase 2):
-- el color se derivará EXCLUSIVAMENTE de estos registros + tareas + cadenas.
--
-- Decisiones de diseño:
--   · INMUTABLE: trigger que bloquea UPDATE/DELETE incluso para service_role.
--     Corrección = nuevo registro con nota (regla 2e de la spec).
--   · Trigger espejo sobre lead_timeline: captura los flujos AUTOMÁTICOS
--     (inbound WA del VPS via webhook_server.py, inbound email, envíos de
--     Stiv con author='system', conversiones) sin tocar el código Python
--     del VPS ni duplicar writers. Los flujos HUMANOS (acciones de panel)
--     insertan directo vía web/lib/contacts.ts con actor real — el espejo
--     los ignora (author <> 'system') para no duplicar.
--   · Dedupe: timeline_id / legacy_accion_id / event_id únicos → cualquier
--     writer y el backfill son idempotentes (C1 de la spec).
--   · occurred_at (cuándo pasó, editable al crear con máx 48h atrás —
--     validado en API) vs created_at (cuándo se registró, auditoría).
--   · La validación "nota_libre >= 5 chars" vive en la API (source='panel');
--     el backfill histórico no puede cumplirla.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS lead_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_type        TEXT        NOT NULL CHECK (actor_type IN ('closer', 'profesor', 'admin', 'stiv', 'lead')),
  -- FK al usuario actor. NULL para stiv y lead (spec 2: actor_id null solo
  -- si actor_type='stiv'; extendemos a 'lead' — el lead no es un user).
  actor_id          UUID        REFERENCES users(id),
  -- Snapshot del nombre para render ("Último contacto: hace 3h (Lorenz)")
  -- sin JOIN y estable aunque el user cambie de nombre.
  actor_name        TEXT,
  direction         TEXT        NOT NULL CHECK (direction IN ('saliente', 'entrante')),
  action_type       TEXT        NOT NULL CHECK (action_type IN (
    -- estructuradas (spec 2)
    'agendar_prueba', 'no_contesto', 'enviar_info', 'enviar_propuesta',
    'seguimiento_pactado', 'enviar_enlace', 'confirmar_pago', 'reactivacion',
    'asistio', 'no_show', 'feedback_profesor',
    -- libres / automáticas
    'nota_libre',       -- contacto fuera de guion registrado desde el panel
    'mensaje_stiv',     -- envío automático de cadena/cron (source stiv_auto)
    'mensaje_lead'      -- mensaje entrante del lead (WhatsApp o email)
  )),
  note              TEXT,
  channel           TEXT        NOT NULL CHECK (channel IN ('whatsapp', 'llamada', 'email', 'aula', 'otro')),
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  source            TEXT        NOT NULL CHECK (source IN (
    'panel', 'stiv_auto', 'webhook_inbound', 'webhook_pago', 'sistema', 'backfill'
  )),
  -- Dedupe / trazabilidad hacia los orígenes:
  timeline_id       UUID UNIQUE REFERENCES lead_timeline(id) ON DELETE SET NULL,
  legacy_accion_id  UUID UNIQUE,   -- acciones_closer.id (backfill)
  event_id          TEXT UNIQUE,   -- id externo (Evolution/Stripe) si aplica
  CONSTRAINT actor_id_solo_humanos CHECK (
    actor_type NOT IN ('stiv', 'lead') OR actor_id IS NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_lead_contacts_lead
  ON lead_contacts(lead_id, occurred_at DESC);
-- "Último contacto saliente" — la query del semáforo y de todas las fichas.
CREATE INDEX IF NOT EXISTS idx_lead_contacts_salientes
  ON lead_contacts(lead_id, occurred_at DESC)
  WHERE direction = 'saliente';
CREATE INDEX IF NOT EXISTS idx_lead_contacts_actor
  ON lead_contacts(actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

ALTER TABLE lead_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_contacts_service ON lead_contacts
  FOR ALL USING (true) WITH CHECK (true);

-- ── Inmutabilidad (spec 2e) ──────────────────────────────────────────────
-- service_role salta RLS y GRANTs, así que la única barrera real es un
-- trigger. Sin excepciones: corrección = nuevo registro.
CREATE OR REPLACE FUNCTION lead_contacts_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'lead_contacts es inmutable: los registros no se editan ni borran (corrección = nuevo registro con nota)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_contacts_immutable ON lead_contacts;
CREATE TRIGGER trg_lead_contacts_immutable
  BEFORE UPDATE OR DELETE ON lead_contacts
  FOR EACH ROW EXECUTE FUNCTION lead_contacts_immutable();

-- ── Trigger espejo: lead_timeline → lead_contacts ────────────────────────
-- Captura SOLO flujos automáticos. Los humanos insertan directo desde la
-- API con actor real (web/lib/contacts.ts):
--   · lead_message_received  → entrante 'lead' (WA del VPS o email IMAP)
--   · system_message_sent / trial_reminder con author='system'/'stiv'
--                            → saliente 'stiv' (cadenas y crons)
--     (author humano, p.ej. 'gelfis', NO se espeja: su route registra
--      el contacto directo con el actor correcto)
--   · conversion             → entrante 'lead' confirmar_pago
CREATE OR REPLACE FUNCTION lead_contacts_mirror_timeline()
RETURNS trigger AS $$
DECLARE
  v_channel TEXT;
BEGIN
  IF NEW.type = 'lead_message_received' THEN
    v_channel := CASE WHEN NEW.metadata->>'channel' = 'email' THEN 'email' ELSE 'whatsapp' END;
    INSERT INTO lead_contacts
      (lead_id, actor_type, direction, action_type, note, channel, occurred_at, source, timeline_id)
    VALUES
      (NEW.lead_id, 'lead', 'entrante', 'mensaje_lead', left(NEW.content, 1000),
       v_channel, NEW.timestamp, 'webhook_inbound', NEW.id)
    ON CONFLICT (timeline_id) DO NOTHING;

  ELSIF NEW.type IN ('system_message_sent', 'trial_reminder')
        AND lower(coalesce(NEW.author, '')) IN ('system', 'stiv', 'bot') THEN
    v_channel := CASE
      WHEN NEW.metadata->>'channel' IN ('whatsapp', 'llamada', 'email', 'aula', 'otro')
        THEN NEW.metadata->>'channel'
      ELSE 'whatsapp'
    END;
    INSERT INTO lead_contacts
      (lead_id, actor_type, direction, action_type, note, channel, occurred_at, source, timeline_id)
    VALUES
      (NEW.lead_id, 'stiv', 'saliente', 'mensaje_stiv', left(NEW.content, 1000),
       v_channel, NEW.timestamp, 'stiv_auto', NEW.id)
    ON CONFLICT (timeline_id) DO NOTHING;

  ELSIF NEW.type = 'conversion' THEN
    INSERT INTO lead_contacts
      (lead_id, actor_type, direction, action_type, note, channel, occurred_at, source, timeline_id)
    VALUES
      (NEW.lead_id, 'lead', 'entrante', 'confirmar_pago', left(NEW.content, 1000),
       'otro', NEW.timestamp,
       CASE WHEN lower(coalesce(NEW.author, '')) IN ('system', 'stiv', 'bot')
            THEN 'webhook_pago' ELSE 'sistema' END,
       NEW.id)
    ON CONFLICT (timeline_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_contacts_mirror ON lead_timeline;
CREATE TRIGGER trg_lead_contacts_mirror
  AFTER INSERT ON lead_timeline
  FOR EACH ROW EXECUTE FUNCTION lead_contacts_mirror_timeline();

-- ── Trigger espejo: acciones_closer → lead_contacts ──────────────────────
-- Todo el módulo closer (Registrar, Capa 1/2) converge en acciones_closer;
-- espejarla aquí cubre esos flujos sin tocar su código. Mapeo tipo →
-- (action_type, channel) según la semántica post-098:
--   reagendado → agendar_prueba · no_contesto/buzon → no_contesto ·
--   venta → enviar_propuesta · mensaje_enviado → enviar_info ·
--   resto (contactado, nota, llamada, whatsapp, email, otro,
--   no_interesado) → nota_libre
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
     v_channel, NEW.created_at, 'panel', NEW.id)
  ON CONFLICT (legacy_accion_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_contacts_mirror_accion ON acciones_closer;
CREATE TRIGGER trg_lead_contacts_mirror_accion
  AFTER INSERT ON acciones_closer
  FOR EACH ROW EXECUTE FUNCTION lead_contacts_mirror_accion();

-- ── Backfill histórico (idempotente vía ON CONFLICT) ─────────────────────

-- 1. lead_timeline → mismos 3 mapeos del trigger, sobre toda la historia.
INSERT INTO lead_contacts
  (lead_id, actor_type, direction, action_type, note, channel, occurred_at, source, timeline_id)
SELECT
  t.lead_id, 'lead', 'entrante', 'mensaje_lead', left(t.content, 1000),
  CASE WHEN t.metadata->>'channel' = 'email' THEN 'email' ELSE 'whatsapp' END,
  t.timestamp, 'backfill', t.id
FROM lead_timeline t
WHERE t.type = 'lead_message_received'
ON CONFLICT (timeline_id) DO NOTHING;

INSERT INTO lead_contacts
  (lead_id, actor_type, direction, action_type, note, channel, occurred_at, source, timeline_id)
SELECT
  t.lead_id, 'stiv', 'saliente', 'mensaje_stiv', left(t.content, 1000),
  CASE WHEN t.metadata->>'channel' IN ('whatsapp', 'llamada', 'email', 'aula', 'otro')
       THEN t.metadata->>'channel' ELSE 'whatsapp' END,
  t.timestamp, 'backfill', t.id
FROM lead_timeline t
WHERE t.type IN ('system_message_sent', 'trial_reminder')
  AND lower(coalesce(t.author, '')) IN ('system', 'stiv', 'bot')
ON CONFLICT (timeline_id) DO NOTHING;

INSERT INTO lead_contacts
  (lead_id, actor_type, direction, action_type, note, channel, occurred_at, source, timeline_id)
SELECT
  t.lead_id, 'lead', 'entrante', 'confirmar_pago', left(t.content, 1000),
  'otro', t.timestamp, 'backfill', t.id
FROM lead_timeline t
WHERE t.type = 'conversion'
ON CONFLICT (timeline_id) DO NOTHING;

-- 2. system_message_sent con author humano ('gelfis'): históricamente son
--    acciones de panel (enviar enlace, follow-ups). Sin actor fiable →
--    actor_type 'admin' con actor_id NULL y el author como nombre. Desde
--    fase 1 en adelante estos flujos insertan directo con actor real.
INSERT INTO lead_contacts
  (lead_id, actor_type, actor_name, direction, action_type, note, channel, occurred_at, source, timeline_id)
SELECT
  t.lead_id, 'admin', t.author, 'saliente', 'enviar_info', left(t.content, 1000),
  CASE WHEN t.metadata->>'channel' IN ('whatsapp', 'llamada', 'email', 'aula', 'otro')
       THEN t.metadata->>'channel' ELSE 'whatsapp' END,
  t.timestamp, 'backfill', t.id
FROM lead_timeline t
WHERE t.type IN ('system_message_sent', 'trial_reminder')
  AND lower(coalesce(t.author, '')) NOT IN ('system', 'stiv', 'bot')
ON CONFLICT (timeline_id) DO NOTHING;

-- 3. acciones_closer → contactos salientes del closer (mismo mapeo que el
--    trigger espejo, con source='backfill' para distinguir la historia).
INSERT INTO lead_contacts
  (lead_id, actor_type, actor_id, actor_name, direction, action_type, note, channel,
   occurred_at, source, legacy_accion_id)
SELECT
  a.lead_id, 'closer', a.closer_id, u.full_name, 'saliente',
  CASE a.tipo
    WHEN 'reagendado'      THEN 'agendar_prueba'
    WHEN 'no_contesto'     THEN 'no_contesto'
    WHEN 'buzon'           THEN 'no_contesto'
    WHEN 'venta'           THEN 'enviar_propuesta'
    WHEN 'mensaje_enviado' THEN 'enviar_info'
    ELSE 'nota_libre'
  END,
  coalesce(nullif(trim(concat_ws(' — ', a.contenido, a.resultado,
                                 a.objection_chip, a.motivo_no_interesado)), ''), '(sin nota)'),
  CASE
    WHEN a.tipo IN ('llamada', 'buzon')            THEN 'llamada'
    WHEN a.tipo IN ('whatsapp', 'mensaje_enviado') THEN 'whatsapp'
    WHEN a.tipo = 'email'                          THEN 'email'
    ELSE 'otro'
  END,
  a.created_at, 'backfill', a.id
FROM acciones_closer a
LEFT JOIN users u ON u.id = a.closer_id
ON CONFLICT (legacy_accion_id) DO NOTHING;

-- ── Vista: último contacto saliente por lead ─────────────────────────────
-- "Último contacto: hace 3h (Lorenz, WhatsApp)" en toda vista de lead
-- (spec 2f). Incluye a Stiv: sus envíos también son contactos.
CREATE OR REPLACE VIEW v_lead_last_contact AS
SELECT DISTINCT ON (lead_id)
  lead_id, occurred_at, actor_type, actor_name, channel, action_type
FROM lead_contacts
WHERE direction = 'saliente'
ORDER BY lead_id, occurred_at DESC;

COMMIT;
