-- 160_post_trial_followups.sql — Gelfis 2026-11-15
--
-- Cola de follow-ups +24h para las 4 acciones post-trial del profesor:
--   - asistio       (profe marcó "Asistió" sin enlace)
--   - no_asistio    (profe marcó "No asistió")
--   - reagendar     (profe marcó "Reagendar")
--   - enviar_enlace (profe marcó "Enviar enlace de inscripción")
--
-- Cada fila se cancela automáticamente cuando:
--   1. El lead responde por WhatsApp (inbound detectado antes del due_at).
--   2. El lead convierte a estudiante.
--   3. El profe marca OTRA acción para el mismo lead (reemplaza).
--
-- El cron /api/cron/post-trial-followups-24h procesa las filas due_at<=NOW
-- con las salvaguardas estándar (night gate 21-09, caps diario/horario
-- del canal setter, jitter ya aplicado en due_at al agendar).

CREATE TABLE IF NOT EXISTS post_trial_followups (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind             text        NOT NULL CHECK (kind IN ('asistio','no_asistio','reagendar','enviar_enlace')),
  due_at           timestamptz NOT NULL,
  reference_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz,
  cancelled_reason text,
  sent_at          timestamptz,
  failed_at        timestamptz,
  last_error       text,
  attempts         int         NOT NULL DEFAULT 0,
  message_id       text,
  context          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Hot path: el cron pregunta "qué está listo para enviar?".
CREATE INDEX IF NOT EXISTS post_trial_followups_due
  ON post_trial_followups (due_at)
  WHERE cancelled_at IS NULL AND sent_at IS NULL;

-- Consulta "¿tengo pendientes para este lead?"
CREATE INDEX IF NOT EXISTS post_trial_followups_lead
  ON post_trial_followups (lead_id, created_at DESC);

COMMENT ON TABLE post_trial_followups IS
  'Cola de +24h follow-ups post-trial. Una fila por acción del profe. Se cancela si el lead responde, convierte, o el profe marca otra acción. El cron la drena respetando night-gate/caps.';
