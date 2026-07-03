-- 078_deferred_trial_notifications.sql
-- Gelfis 2026-06-30: retrasa las notificaciones de trial-confirmation
-- 5 min tras el book-trial para dar tiempo a que el lead complete el
-- pago del depósito en Stripe (10€). Si el lead paga, la notificación
-- llega con copy "plaza asegurada"; si no paga, incluye el link para
-- asegurarla.
--
-- Columnas en classes:
--  · notify_after_at  — cuándo puede el cron enviar las notificaciones
--  · notified_at      — marca idempotente del envío
--  · deposit_paid_at  — marca de pago del depósito (self-reported por
--                       /confirmacion?deposito=ok; Stripe webhook lo
--                       confirmará después cuando se conecte).

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS notify_after_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_paid_at  TIMESTAMPTZ;

-- Índice parcial para que el cron ubique rápido las clases pendientes.
-- Solo indexa filas que aún no se han notificado y tienen fecha
-- programada; esas son <100 en cualquier momento.
CREATE INDEX IF NOT EXISTS idx_classes_notify_pending
  ON classes (notify_after_at)
  WHERE notified_at IS NULL AND notify_after_at IS NOT NULL;
