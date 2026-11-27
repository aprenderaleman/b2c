-- 168_wa_delivery_tracking.sql — Gelfis 2026-11-27
--
-- Tras caso Rosa (+41794828810): todos los mensajes enviados por V6
-- quedaron en "Esperando el mensaje" en su móvil porque la sesión
-- Signal se desincronizó al reconectar V6 (identity keys nuevas que
-- su teléfono rechaza). Evolution reporta "sent OK" (ack=1) pero la
-- entrega real (ack=2 DELIVERY_ACK) nunca ocurre.
--
-- Esta tabla trackea cada WA auto saliente para detectar ese patrón:
--   - Al enviar → fila nueva con last_status=PENDING y wa_message_id
--   - Cron wa-delivery-monitor (cada 5m) → consulta Evolution
--     findMessages y actualiza last_status
--   - Si sent_at > 10min y last_status < DELIVERY_ACK → stuck_at=NOW()
--   - Cron wa-delivery-recover (cada 10m) → deleteSession + resend
--   - Si tras recovery siguen sin entregar → stash manual + alerta
--
-- Solo trackea envíos CON lead_id (los del canal transaccional).

CREATE TABLE IF NOT EXISTS wa_delivery_tracking (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               uuid        REFERENCES leads(id) ON DELETE CASCADE,
  wa_message_id         text        NOT NULL,
  phone_e164            text        NOT NULL,
  instance              text        NOT NULL,
  kind                  text        NOT NULL,
  text_preview          text,
  original_text         text        NOT NULL,
  sent_at               timestamptz NOT NULL DEFAULT now(),
  last_status           text        NOT NULL DEFAULT 'PENDING'
    CHECK (last_status IN ('PENDING','SERVER_ACK','DELIVERY_ACK','READ','PLAYED')),
  last_checked_at       timestamptz,
  check_count           int         NOT NULL DEFAULT 0,
  delivered_at          timestamptz,
  stuck_at              timestamptz,
  recovery_attempted_at timestamptz,
  recovery_action       text,
  recovered_at          timestamptz,
  failed_at             timestamptz,
  fail_reason           text,
  context               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Único: no debe haber dos filas para el mismo wa_message_id (dedup
-- si hubiera doble inserción desde un retry).
CREATE UNIQUE INDEX IF NOT EXISTS wa_delivery_tracking_msgid
  ON wa_delivery_tracking (wa_message_id);

-- Hot path monitor: "qué está pendiente de chequear?"
CREATE INDEX IF NOT EXISTS wa_delivery_tracking_monitor
  ON wa_delivery_tracking (sent_at)
  WHERE delivered_at IS NULL AND stuck_at IS NULL AND failed_at IS NULL;

-- Hot path recovery: "qué está stuck pendiente de recovery?"
CREATE INDEX IF NOT EXISTS wa_delivery_tracking_recovery
  ON wa_delivery_tracking (stuck_at)
  WHERE stuck_at IS NOT NULL AND recovery_attempted_at IS NULL AND failed_at IS NULL;

-- Hot path fallback: "qué recovery ya se intentó pero sigue sin entregar?"
CREATE INDEX IF NOT EXISTS wa_delivery_tracking_fallback
  ON wa_delivery_tracking (recovery_attempted_at)
  WHERE recovery_attempted_at IS NOT NULL AND delivered_at IS NULL AND failed_at IS NULL;

-- Para búsquedas por lead (debugging + panel admin).
CREATE INDEX IF NOT EXISTS wa_delivery_tracking_lead
  ON wa_delivery_tracking (lead_id, sent_at DESC)
  WHERE lead_id IS NOT NULL;
