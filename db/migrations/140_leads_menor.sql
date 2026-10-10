-- Migration 140 — leads de menores (landing /clase-ninos, 2026-10-09).
-- El lead es el padre/madre (name/email/whatsapp); los datos del hijo/a
-- van en menor_datos:
--   { hijo_nombre, hijo_edad (6-17), nivel_escolar, tiempo_alemania, objetivo }
-- lead_tipo NULL = lead adulto de siempre.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_tipo TEXT
    CHECK (lead_tipo IS NULL OR lead_tipo IN ('adulto', 'menor')),
  ADD COLUMN IF NOT EXISTS menor_datos JSONB;

CREATE INDEX IF NOT EXISTS leads_lead_tipo_idx ON leads(lead_tipo) WHERE lead_tipo IS NOT NULL;

COMMIT;
