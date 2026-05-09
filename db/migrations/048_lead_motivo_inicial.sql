-- ============================================================
-- 048 — motivo_inicial: nuevo paso 1 del funnel para Quality Score
-- ============================================================
-- Se añade al funnel en `/` un paso previo a la pregunta de nivel
-- que captura las keywords objetivo de Google Ads. Persistimos:
--   · `leads.motivo_inicial`   → para el CRM sin joins
--   · tabla `lead_motivo_inicial` → con session_id para enlazar
--     respuestas tempranas (antes de crear el lead) con el lead
--     final cuando se complete el funnel.
-- ============================================================

-- 1) Columna directa en leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS motivo_inicial TEXT;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_motivo_inicial_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_motivo_inicial_check
  CHECK (motivo_inicial IS NULL OR motivo_inicial IN (
    'particulares','intensivo','certificado','profesional','otro'
  ));

COMMENT ON COLUMN leads.motivo_inicial IS
  'Respuesta del paso 1 nuevo del funnel (Q.Score). NULL para leads previos al cambio.';

-- 2) Tabla histórica con session_id
CREATE TABLE IF NOT EXISTS lead_motivo_inicial (
  id           BIGSERIAL PRIMARY KEY,
  lead_id      UUID REFERENCES leads(id) ON DELETE SET NULL,
  session_id   TEXT NOT NULL,
  motivo       TEXT NOT NULL CHECK (motivo IN (
                 'particulares','intensivo','certificado','profesional','otro'
               )),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_motivo_inicial_session_id_idx
  ON lead_motivo_inicial (session_id);
CREATE INDEX IF NOT EXISTS lead_motivo_inicial_lead_id_idx
  ON lead_motivo_inicial (lead_id);

-- Una respuesta por session_id (el cliente puede cambiarla via UPSERT)
CREATE UNIQUE INDEX IF NOT EXISTS lead_motivo_inicial_session_unique
  ON lead_motivo_inicial (session_id);

COMMENT ON TABLE lead_motivo_inicial IS
  'Respuesta del paso 1 (motivo_inicial). Se inserta antes de que el lead exista (lead_id NULL) y se enlaza por session_id cuando el lead se crea al final del funnel.';
