-- 068_trial_script_v2.sql
--
-- Nuevas columnas para el wizard /cp v2 (secciones 0-7).
-- Reutiliza columnas existentes donde el shape coincide:
--   objetivo, nivel_objetivo, motivacion, chosen_pack, payment_type,
--   teacher_notes, final_outcome.
-- Agrega columnas para las secciones nuevas.

BEGIN;

-- Sección 1: Presentación — checkboxes de rapport (delimited text)
ALTER TABLE trial_class_scripts
  ADD COLUMN IF NOT EXISTS presentacion_checks text;

-- Sección 3: Mini clase — checkboxes post-clase + observaciones
ALTER TABLE trial_class_scripts
  ADD COLUMN IF NOT EXISTS mini_clase_checks text,
  ADD COLUMN IF NOT EXISTS mini_clase_obs text;

-- Sección 4: Transición al cierre — 3 preguntas radio
ALTER TABLE trial_class_scripts
  ADD COLUMN IF NOT EXISTS cierre_q1 text,
  ADD COLUMN IF NOT EXISTS cierre_q2 text,
  ADD COLUMN IF NOT EXISTS cierre_q3 text;

-- Sección 6: Confirmación de pago en vivo
ALTER TABLE trial_class_scripts
  ADD COLUMN IF NOT EXISTS payment_confirmed boolean;

-- Sección 7: Resultado granular + razones de no-compra
ALTER TABLE trial_class_scripts
  ADD COLUMN IF NOT EXISTS resultado text,
  ADD COLUMN IF NOT EXISTS resultado_razones text;

-- Ampliar final_outcome para incluir 'converted'
ALTER TABLE trial_class_scripts
  DROP CONSTRAINT IF EXISTS trial_class_scripts_final_outcome_check;
ALTER TABLE trial_class_scripts
  ADD CONSTRAINT trial_class_scripts_final_outcome_check
  CHECK (final_outcome IS NULL OR final_outcome IN ('attended','absent','converted'));

-- current_step ahora empieza en 0 (Preparación). Las filas viejas con
-- current_step=1 siguen siendo válidas (el wizard v2 las trata como
-- sección 1).

COMMIT;
