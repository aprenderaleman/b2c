-- 055_leads_optional_funnel_fields.sql
-- Tras la simplificación del funnel a 2 preguntas (2026-05-26), los
-- campos goal y urgency ya no se capturan en el quiz — Stiv los
-- pregunta por WhatsApp. Hay que permitir NULL en BD para que el
-- INSERT inicial no falle.
--
-- german_level se mantiene NOT NULL porque es la única pregunta
-- imprescindible (el funnel siempre la pide).

ALTER TABLE leads
  ALTER COLUMN goal    DROP NOT NULL,
  ALTER COLUMN urgency DROP NOT NULL;
