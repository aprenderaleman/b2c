BEGIN;

CREATE TABLE IF NOT EXISTS costes_fijos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  category      text        NOT NULL DEFAULT 'herramientas'
                CHECK (category IN ('hosting', 'herramientas', 'profesores', 'ads', 'otros')),
  amount_cents  integer     NOT NULL CHECK (amount_cents > 0),
  currency      text        NOT NULL DEFAULT 'EUR',
  active        boolean     NOT NULL DEFAULT true,
  starts_at     date        NOT NULL DEFAULT CURRENT_DATE,
  ends_at       date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE costes_fijos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON costes_fijos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION costes_fijos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_costes_fijos_updated_at
  BEFORE UPDATE ON costes_fijos
  FOR EACH ROW EXECUTE FUNCTION costes_fijos_updated_at();

COMMIT;
