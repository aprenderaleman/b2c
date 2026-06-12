-- 059_message_templates.sql
--
-- Catálogo editable de plantillas de mensajes que envía el sistema.
-- Hasta hoy cada texto vivía hardcoded en código (TS o Python) — para
-- A/B-testear o mejorar copys había que editar, deployar y reiniciar.
--
-- Esta tabla guarda overrides editables desde /admin/mensajes:
--   - Si la plantilla existe aquí con active=true → el código usa el body de aquí.
--   - Si no existe / inactive → el código cae al hardcoded original.
--
-- La métrica de efectividad se calcula on-the-fly contra lead_timeline:
--   * sent  = count(type='system_message_sent' AND metadata->>'kind' = X)
--   * resp  = sent que tienen un lead_message_received del mismo lead
--             dentro de 7 días después
--
-- Por eso esta tabla NO duplica los conteos — son fuente única.

BEGIN;

CREATE TABLE IF NOT EXISTS message_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificador estable usado por el código para buscar la plantilla.
  -- Mismo valor que el `kind` que se logea en lead_timeline.metadata.
  -- Ej: 'diagnostico_welcome', 'post_trial_followup_pack', 'absent_followup_1'
  kind          text        NOT NULL,
  -- Sub-secuencia opcional para distinguir variantes dentro de un kind.
  -- Ej: diagnostico_followup tiene mensajes #1, #2, ..., #6 con copy
  -- distinto cada uno. sub_n=NULL = el unico mensaje del kind.
  sub_n         int,
  channel       text        NOT NULL CHECK (channel IN ('whatsapp','email','both')),
  name          text        NOT NULL,         -- display name
  description   text,                          -- a quién/cuándo se envía
  body          text        NOT NULL,         -- cuerpo con {placeholders}
  -- placeholders documentados por plantilla (e.g. ['firstName','packName'])
  placeholders  text[]      NOT NULL DEFAULT '{}',
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_by    text,
  UNIQUE (kind, sub_n, channel)
);

CREATE INDEX IF NOT EXISTS message_templates_kind_idx
  ON message_templates (kind, channel) WHERE active = true;

-- Tabla simple key→value para alertas globales: por ejemplo guardamos
-- el último timestamp en que un editor pulsó "save". No vital.

COMMIT;
