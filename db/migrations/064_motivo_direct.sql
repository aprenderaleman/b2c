-- 064_motivo_direct.sql
--
-- Añade el valor 'direct' al CHECK de motivo_inicial en `leads` y al
-- CHECK del enum motivo en `lead_motivo_inicial`. Esto representa los
-- leads que llegan por el atajo /agendar/cuando (botón verde "Reservar
-- mi Clase Gratis" en las landings) — entran al funnel directo al
-- calendario, sin pasar por la pregunta de motivo del quiz.
--
-- Por qué importa para /admin/ads:
--   El dashboard distingue "Form completado" por motivo_inicial NOT NULL.
--   Hasta ahora los leads del atajo se contaban en "Trial agendada" pero
--   no en "Form completado", reventando la ratio trial/form
--   (>100 %). Marcándolos como motivo='direct' la cadena del funnel
--   queda honesta y aparecen como un bucket propio en el desglose.

BEGIN;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_motivo_inicial_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_motivo_inicial_check
  CHECK (motivo_inicial IS NULL OR motivo_inicial IN (
    'particulares','intensivo','certificado','profesional','otro','direct'
  ));

ALTER TABLE lead_motivo_inicial
  DROP CONSTRAINT IF EXISTS lead_motivo_inicial_motivo_check;
ALTER TABLE lead_motivo_inicial
  ADD CONSTRAINT lead_motivo_inicial_motivo_check
  CHECK (motivo IN (
    'particulares','intensivo','certificado','profesional','otro','direct'
  ));

COMMENT ON CONSTRAINT lead_motivo_inicial_motivo_check ON lead_motivo_inicial IS
  'Valores válidos: 4 motivos del quiz + otro + direct (atajo desde landing/agendar-directo, no pasa por quiz). Ver migration 064.';

COMMIT;
