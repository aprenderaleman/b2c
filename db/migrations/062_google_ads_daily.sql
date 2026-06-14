BEGIN;

CREATE TABLE IF NOT EXISTS google_ads_daily (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  date            date    NOT NULL,
  account_id      text    NOT NULL,
  campaign_id     text,
  campaign_name   text,
  impressions     integer NOT NULL DEFAULT 0,
  clicks          integer NOT NULL DEFAULT 0,
  cost_micros     bigint  NOT NULL DEFAULT 0,
  conversions     numeric(10,2) DEFAULT 0,
  currency        text    NOT NULL DEFAULT 'EUR',
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS google_ads_daily_date_idx
  ON google_ads_daily (date DESC);

ALTER TABLE google_ads_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON google_ads_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
