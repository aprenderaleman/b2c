-- 042_rate_limit_log.sql
--
-- Postgres-backed sliding-window rate limiter. One row per attempt;
-- the helper in web/lib/rate-limit.ts counts rows newer than a
-- cutoff for (scope, key) and rejects if the count is at the cap.
--
-- We use Postgres instead of Upstash/Redis because:
--   - We already have a hot Supabase connection per request.
--   - Volume is low (a few thousand attempts/day at most).
--   - One less external dependency to operate / pay for.
--
-- A daily janitor (cron 0 4 * * *) trims rows >7 days to keep the
-- table small.

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text        NOT NULL,                -- e.g. 'book_trial', 'login_attempt'
  key         text        NOT NULL,                -- IP, email, user_id, etc.
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Hot-path index: count rows in a (scope, key) window.
CREATE INDEX IF NOT EXISTS rate_limit_log_lookup
  ON rate_limit_log (scope, key, created_at DESC);

-- Index for the daily janitor to find old rows quickly.
CREATE INDEX IF NOT EXISTS rate_limit_log_age
  ON rate_limit_log (created_at);

COMMENT ON TABLE rate_limit_log IS
  'Sliding-window rate-limit log. Counted by web/lib/rate-limit.ts. Janitor drops rows older than 7 days.';
