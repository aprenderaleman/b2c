BEGIN;

CREATE TABLE IF NOT EXISTS ofertas_enviadas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    meta        TEXT NOT NULL,          -- goal: a1_a2, b1, b2, c1, fluidez_total
    ritmo       TEXT,                   -- viajero, estandar, intensivo, vip_express (NULL if pago unico)
    tipo_pago   TEXT NOT NULL CHECK (tipo_pago IN ('suscripcion', 'unico')),
    clases_totales  INT NOT NULL CHECK (clases_totales > 0),
    clases_por_mes  INT CHECK (clases_por_mes > 0),  -- NULL if pago unico
    importe_cents   INT NOT NULL CHECK (importe_cents > 0),
    moneda      TEXT NOT NULL DEFAULT 'EUR',
    stripe_price_id TEXT,
    accepted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ofertas_enviadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON ofertas_enviadas
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_ofertas_lead ON ofertas_enviadas(lead_id);
CREATE INDEX idx_ofertas_teacher ON ofertas_enviadas(teacher_id);

COMMIT;
