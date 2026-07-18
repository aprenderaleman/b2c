-- Drip-send support for admin_broadcasts.
--
-- pacing_ms        — ms to wait between recipients (default 250 = current behaviour)
-- dispatched_count — how many recipients have already been sent across previous cron batches
-- next_batch_at    — when the next batch may start; acts as a distributed lock for the cron
--
-- With these three columns the dispatch cron can send N messages per 5-min
-- tick (where N = floor(4 min budget / pacing_ms)) and continue across ticks
-- until the whole audience is covered, without any risk of double-dispatch.

ALTER TABLE admin_broadcasts
  ADD COLUMN IF NOT EXISTS pacing_ms        INTEGER     NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS dispatched_count INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_batch_at    TIMESTAMPTZ;
