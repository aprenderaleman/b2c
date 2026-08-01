BEGIN;

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS clases_totales          INT,
    ADD COLUMN IF NOT EXISTS clases_desbloqueadas    INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS oferta_id               UUID REFERENCES ofertas_enviadas(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS conversion_source        TEXT CHECK (conversion_source IN ('stripe_auto', 'manual', 'legacy')),
    ADD COLUMN IF NOT EXISTS commission_window_end    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT CHECK (stripe_subscription_status IN ('active', 'past_due', 'canceled'));

COMMIT;
