-- ============================================================
-- Migration 058 — Track landing_intent separately from motivo_inicial
--
-- Gelfis 2026-06-XX: lanzamos 6 landings dedicadas (curso-online,
-- particulares, intensivo, certificado, b2-trabajar, ciudades) para
-- subir el Ad Rank en Google Ads. Necesitamos saber "de qué landing
-- vino el lead" SEPARADO de "qué motivo eligió en el quiz".
--
-- Si fundimos los dos, perdemos señal: un lead que llega a la landing
-- generic /curso-aleman-online y escoge 'intensivo' en el quiz NO es
-- lo mismo que uno que llegó por /curso-intensivo-aleman. Ambos
-- terminan con motivo='intensivo' pero la calidad/CPA es distinta.
--
-- Esquema:
--   landing_intent  TEXT  (free-form slug: 'home','curso-online',
--                          'particulares','intensivo','certificado',
--                          'b2-trabajar','ciudades', o cualquier nuevo
--                          en el futuro). NULL para leads históricos
--                          previos a esta migration.
-- ============================================================

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS landing_intent TEXT;

ALTER TABLE lead_motivo_inicial
    ADD COLUMN IF NOT EXISTS landing_intent TEXT;

ALTER TABLE funnel_progress
    ADD COLUMN IF NOT EXISTS landing_intent TEXT;

-- Índices para queries del dashboard /admin/ads — filtran muy a
-- menudo por landing concreta y la cardinalidad es baja (~7 valores).
CREATE INDEX IF NOT EXISTS idx_leads_landing_intent
    ON leads(landing_intent)
    WHERE landing_intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_motivo_landing_intent
    ON lead_motivo_inicial(landing_intent)
    WHERE landing_intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_funnel_progress_landing_intent
    ON funnel_progress(landing_intent)
    WHERE landing_intent IS NOT NULL;
