-- 040_outbound_queue.sql
--
-- Buffer table for any WhatsApp message we couldn't deliver
-- immediately (Evolution session disconnected, http_503, transient
-- network blips). The agents-VPS scheduler runs `tick_outbound_queue`
-- every 30 s; it picks rows whose `next_attempt_at` is in the past
-- and tries to send them. Exponential backoff caps at 6 attempts /
-- ~6 hours so we don't spam an unrecoverable destination.
--
-- Once a row reaches `sent` status we keep it for 30 days as an
-- audit trail then drop it via the daily janitor (separate cron).
--
-- Schema purposely lean — no foreign keys to the `classes` table so
-- a class can be cancelled without orphaning queued retries; we
-- just key on `lead_id` (nullable) for cross-referencing.

CREATE TABLE IF NOT EXISTS outbound_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid        REFERENCES leads(id) ON DELETE SET NULL,
  phone_e164      text        NOT NULL,
  body            text        NOT NULL,
  kind            text        NOT NULL,                            -- trial_confirmation | trial_reminder | absent_followup | manual | other
  status          text        NOT NULL DEFAULT 'queued',            -- queued | sent | failed_permanent
  attempts        int         NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  message_id      text,                                             -- Evolution message id once successfully sent
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  CONSTRAINT outbound_queue_status_chk CHECK (status IN ('queued','sent','failed_permanent'))
);

-- Hot path: the scheduler asks "what's due to send?". Partial index
-- ignores `sent` and `failed_permanent` rows so the index stays tiny.
CREATE INDEX IF NOT EXISTS outbound_queue_due
  ON outbound_queue (next_attempt_at)
  WHERE status = 'queued';

-- For dashboards / audit: lookups by lead_id are common.
CREATE INDEX IF NOT EXISTS outbound_queue_lead
  ON outbound_queue (lead_id, created_at DESC);

COMMENT ON TABLE outbound_queue IS
  'Retry buffer for WhatsApp sends that hit transient errors (Evolution disconnect, 503, network). Drained by the agents-VPS scheduler every 30s with exponential backoff.';
