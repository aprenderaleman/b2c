-- 058_trial_class_scripts.sql
--
-- Guion + captura de datos del profesor durante una clase de prueba.
-- Una fila por clase (UNIQUE class_id). Cada paso del wizard hace
-- auto-save tras "Siguiente" para que el profe no pierda nada si
-- cierra la pestaña.
--
-- Se usa desde /cp/[classId] (página del wizard) y se lee desde
-- /admin/profesores/[id]/performance para medir conversión por profe.

BEGIN;

CREATE TABLE IF NOT EXISTS trial_class_scripts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        uuid        NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  lead_id         uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  teacher_id      uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Lifecycle
  started_at      timestamptz NOT NULL DEFAULT NOW(),
  completed_at    timestamptz,
  current_step    int         NOT NULL DEFAULT 1,

  -- Paso 1 — Discovery
  objetivo        text,
  nivel_objetivo  text,
  deadline        text,
  motivacion      text,

  -- Paso 3 — Post-demo
  feedback_clase  text,
  feedback_gusto  text,
  -- enrollment_sense: true=si tiene sentido inscribirse, false=no, null=sin marcar
  enrollment_sense  boolean,

  -- Paso 3b — Manejo de objeción (sólo si enrollment_sense=false)
  objection_reason  text,   -- por qué el lead no lo ve / qué le frena
  objection_unblock text,   -- qué necesitaría para verlo

  -- Paso 4 — Filtros pack
  schedule_type     text  CHECK (schedule_type   IS NULL OR schedule_type   IN ('fixed','changing')),
  learning_goal     text  CHECK (learning_goal   IS NULL OR learning_goal   IN ('one_level','confidence')),

  -- Paso 5-6 — Selección
  presented_packs   text[],   -- array de PackId (ej. ['vip_individual','vip_express'])
  chosen_pack       text,     -- PackId final
  payment_type      text  CHECK (payment_type    IS NULL OR payment_type    IN ('single','flexible')),

  -- Paso 7 — Cierre
  closing_yes       boolean,  -- ¿aceptó recibir el enlace de pago?

  -- Paso 8 — Resultado final
  -- 'attended' / 'absent' / null (todavía sin marcar)
  final_outcome     text  CHECK (final_outcome   IS NULL OR final_outcome   IN ('attended','absent')),
  final_marked_at   timestamptz,

  -- Notas libres del profe
  teacher_notes     text,

  UNIQUE (class_id)
);

CREATE INDEX IF NOT EXISTS trial_class_scripts_teacher_idx
  ON trial_class_scripts (teacher_id, started_at DESC);

CREATE INDEX IF NOT EXISTS trial_class_scripts_lead_idx
  ON trial_class_scripts (lead_id);

CREATE INDEX IF NOT EXISTS trial_class_scripts_outcome_idx
  ON trial_class_scripts (final_outcome, completed_at DESC);

COMMIT;
