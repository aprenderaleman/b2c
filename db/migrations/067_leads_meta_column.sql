-- Migration 067: leads.meta jsonb
--
-- Bug raiz descubierto 2026-06-17 al investigar flow post-asistio:
-- el codigo web/lib/admin-actions.ts asume una columna `meta` jsonb
-- que NUNCA se creo en BD. Resultado: tras "Asistio" con pack+pago,
-- los campos awaiting_payment_confirmation_since, last_offered_pack,
-- last_offered_payment, last_offered_objective y post_trial_step se
-- pierden silenciosamente. El cron /api/cron/post-trial-followups
-- depende de meta->>'awaiting_payment_confirmation_since' para
-- decidir a quien tocar — por eso M2 y M3 del flow post-trial
-- NUNCA se han enviado (0 registros en 30d, solo M1).
--
-- Fix: crear la columna con default '{}'::jsonb para que las queries
-- existentes funcionen sin cambios.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN leads.meta IS
  'JSON metadata bag para campos transversales del lead — '
  'awaiting_payment_confirmation_since, last_offered_pack, '
  'last_offered_payment, last_offered_objective, post_trial_step. '
  'Set por web/lib/admin-actions.ts y consumido por crons + Stiv.';
