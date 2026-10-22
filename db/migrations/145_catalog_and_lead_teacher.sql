-- Catálogo central de precios/comisiones/bonos con versionado por fecha
-- + rol "profesor líder" (is_lead) + sesiones de coaching profe↔profe.
-- Nada visible hasta que system_config.catalog_active_version = 'v2'.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO — TABLAS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE catalog_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version      text NOT NULL UNIQUE,
  effective_at timestamptz NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        uuid NOT NULL REFERENCES catalog_versions(id),
  slug              text NOT NULL,
  label             text NOT NULL,
  type              text NOT NULL CHECK (type IN ('subscription','one_time','kids','duo')),
  price_cents       int  NOT NULL,
  classes_total     int,
  classes_per_month int,
  stripe_link       text,
  surcharge_pct     int  NOT NULL DEFAULT 0,
  sort_order        int  NOT NULL DEFAULT 0,
  UNIQUE(version_id, slug)
);

CREATE TABLE catalog_commissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id   uuid NOT NULL REFERENCES catalog_versions(id),
  plan_slug    text NOT NULL,
  seller_id    uuid REFERENCES teachers(id),
  amount_cents int  NOT NULL
);

-- Partial unique index: one default (seller_id IS NULL) per version+plan
CREATE UNIQUE INDEX uq_catalog_commissions_default
  ON catalog_commissions (version_id, plan_slug)
  WHERE seller_id IS NULL;

-- And one per seller per version+plan
CREATE UNIQUE INDEX uq_catalog_commissions_seller
  ON catalog_commissions (version_id, plan_slug, seller_id)
  WHERE seller_id IS NOT NULL;

CREATE TABLE catalog_bonos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id   uuid NOT NULL REFERENCES catalog_versions(id),
  plan_slug    text NOT NULL,
  bono_cents   int  NOT NULL,
  e2_factor    numeric NOT NULL DEFAULT 0.5,
  renewal_full boolean NOT NULL DEFAULT true,
  UNIQUE(version_id, plan_slug)
);

CREATE TABLE catalog_bonus_ladder (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id      uuid NOT NULL REFERENCES catalog_versions(id),
  threshold       int     NOT NULL DEFAULT 4,
  multiplier      numeric NOT NULL DEFAULT 2,
  counts_e1       boolean NOT NULL DEFAULT true,
  counts_e2       boolean NOT NULL DEFAULT true,
  counts_renewal  boolean NOT NULL DEFAULT false,
  duo_per_person  boolean NOT NULL DEFAULT true,
  reset_day       int     NOT NULL DEFAULT 1,
  UNIQUE(version_id)
);

-- Cohorte: cada alumno queda fijado a su versión de catálogo
ALTER TABLE students ADD COLUMN IF NOT EXISTS catalog_version_id uuid REFERENCES catalog_versions(id);

-- Activación global
INSERT INTO system_config (key, value)
VALUES ('catalog_active_version', 'v1')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SEED v1 — condiciones actuales (effective desde siempre)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO catalog_versions (id, version, effective_at, description) VALUES
  ('11111111-0000-0000-0000-000000000001', 'v1', '2020-01-01T00:00:00Z', 'Condiciones originales');

-- Planes v1
INSERT INTO catalog_plans (version_id, slug, label, type, price_cents, classes_per_month, stripe_link, sort_order) VALUES
  ('11111111-0000-0000-0000-000000000001', 'viajero',     'Viajero',     'subscription', 24000,  6, 'https://buy.stripe.com/cNi7sE8Hjd9Wfkr2uP0co0D', 1),
  ('11111111-0000-0000-0000-000000000001', 'estandar',    'Estándar',    'subscription', 32000,  8, 'https://buy.stripe.com/bJeeV6e1D4Dqc8fd9t0co0v', 2),
  ('11111111-0000-0000-0000-000000000001', 'intensivo',   'Intensivo',   'subscription', 45000, 12, 'https://buy.stripe.com/6oUcMY9Ln5Hu2xFb1l0co0w', 3),
  ('11111111-0000-0000-0000-000000000001', 'vip_express', 'VIP Express', 'subscription', 69000, 16, 'https://buy.stripe.com/bJe6oA8Hj5Hu4FN2uP0co0x', 4),
  ('11111111-0000-0000-0000-000000000001', 'duo',         'Dúo',         'duo',          25000,  8, NULL, 5);

INSERT INTO catalog_plans (version_id, slug, label, type, price_cents, classes_total, stripe_link, sort_order) VALUES
  ('11111111-0000-0000-0000-000000000001', 'a1_a2',         'A2 Arranque Alemania',  'one_time', 118000, 32, 'https://buy.stripe.com/aFa00caPrb1Odcj1qL0co0y', 10),
  ('11111111-0000-0000-0000-000000000001', 'b1',            'B1 Tu B1 Garantizado',  'one_time', 172000, 48, 'https://buy.stripe.com/00w28kf5H7PCa078Td0co0z', 11),
  ('11111111-0000-0000-0000-000000000001', 'b2',            'B2 Nivel Avanzado',     'one_time', 172000, 48, 'https://buy.stripe.com/28EdR2g9L5Hua075H10co0A', 12),
  ('11111111-0000-0000-0000-000000000001', 'c1',            'C1 Nivel Profesional',  'one_time', 210000, 48, 'https://buy.stripe.com/6oU8wI6zb8TG4FN6L50co0B', 13),
  ('11111111-0000-0000-0000-000000000001', 'fluidez_total', 'Fluidez Total (A1→B1)', 'one_time', 299000, 92, 'https://buy.stripe.com/dRmcMYe1Dd9W8W35H10co0r', 14),
  ('11111111-0000-0000-0000-000000000001', 'kids',          'Pack Kids',             'kids',      89000, 24, 'https://buy.stripe.com/4gMeV68Hj5Hu8W3d9t0co0o', 20);

-- Bonos de cierre v1 (current values from config_comisiones)
INSERT INTO catalog_bonos (version_id, plan_slug, bono_cents, e2_factor, renewal_full) VALUES
  ('11111111-0000-0000-0000-000000000001', 'viajero',      2500, 0.5, true),
  ('11111111-0000-0000-0000-000000000001', 'estandar',     3500, 0.5, true),
  ('11111111-0000-0000-0000-000000000001', 'intensivo',    5000, 0.5, true),
  ('11111111-0000-0000-0000-000000000001', 'vip_express',  7500, 0.5, true),
  ('11111111-0000-0000-0000-000000000001', 'pago_unico', 15000, 0.5, true),
  ('11111111-0000-0000-0000-000000000001', 'duo',          2500, 0.5, true);

-- v1 no tiene escalera de bonos (no se inserta fila)

-- v1 no tiene comisiones fijas recurrentes por plan
-- (el sistema actual usa rangos porcentuales, no montos fijos)

-- ═══════════════════════════════════════════════════════════════════════
-- 3. SEED v2 — nuevas condiciones (vigencia 01.11.2026)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO catalog_versions (id, version, effective_at, description) VALUES
  ('22222222-0000-0000-0000-000000000002', 'v2', '2026-11-01T00:00:00+01:00', 'Subida de precios noviembre 2026');

-- Planes v2 (Stripe links pendientes — se rellenan por separado)
INSERT INTO catalog_plans (version_id, slug, label, type, price_cents, classes_per_month, surcharge_pct, sort_order) VALUES
  ('22222222-0000-0000-0000-000000000002', 'viajero',     'Viajero',     'subscription', 29000,  6, 20, 1),
  ('22222222-0000-0000-0000-000000000002', 'estandar',    'Estándar',    'subscription', 39000,  8, 20, 2),
  ('22222222-0000-0000-0000-000000000002', 'intensivo',   'Intensivo',   'subscription', 56000, 12, 20, 3),
  ('22222222-0000-0000-0000-000000000002', 'vip_express', 'VIP Express', 'subscription', 86000, 16, 20, 4),
  ('22222222-0000-0000-0000-000000000002', 'duo',         'Dúo',         'duo',          25000,  8,  0, 5);

-- Comisiones recurrentes v2 — equipo estándar (seller_id = NULL)
INSERT INTO catalog_commissions (version_id, plan_slug, seller_id, amount_cents) VALUES
  ('22222222-0000-0000-0000-000000000002', 'viajero',     NULL, 2400),
  ('22222222-0000-0000-0000-000000000002', 'estandar',    NULL, 3200),
  ('22222222-0000-0000-0000-000000000002', 'intensivo',   NULL, 4500),
  ('22222222-0000-0000-0000-000000000002', 'vip_express', NULL, 6900),
  ('22222222-0000-0000-0000-000000000002', 'duo',         NULL, 2500);

-- Comisiones recurrentes v2 — Jonathan (tarifa individual)
INSERT INTO catalog_commissions (version_id, plan_slug, seller_id, amount_cents) VALUES
  ('22222222-0000-0000-0000-000000000002', 'viajero',     '468968b1-4c0a-4759-af4e-4f63ac67eabf', 3600),
  ('22222222-0000-0000-0000-000000000002', 'estandar',    '468968b1-4c0a-4759-af4e-4f63ac67eabf', 4800),
  ('22222222-0000-0000-0000-000000000002', 'intensivo',   '468968b1-4c0a-4759-af4e-4f63ac67eabf', 6800),
  ('22222222-0000-0000-0000-000000000002', 'vip_express', '468968b1-4c0a-4759-af4e-4f63ac67eabf', 10400),
  ('22222222-0000-0000-0000-000000000002', 'duo',         '468968b1-4c0a-4759-af4e-4f63ac67eabf', 3800);

-- Bonos de cierre v2 (same amounts as v1)
INSERT INTO catalog_bonos (version_id, plan_slug, bono_cents, e2_factor, renewal_full) VALUES
  ('22222222-0000-0000-0000-000000000002', 'viajero',      2500, 0.5, true),
  ('22222222-0000-0000-0000-000000000002', 'estandar',     3500, 0.5, true),
  ('22222222-0000-0000-0000-000000000002', 'intensivo',    5000, 0.5, true),
  ('22222222-0000-0000-0000-000000000002', 'vip_express',  7500, 0.5, true),
  ('22222222-0000-0000-0000-000000000002', 'pago_unico', 15000, 0.5, true),
  ('22222222-0000-0000-0000-000000000002', 'duo',          2500, 0.5, true);

-- Escalera de bonos v2: desde 4ª venta del mes, ×2
INSERT INTO catalog_bonus_ladder (version_id, threshold, multiplier, counts_e1, counts_e2, counts_renewal, duo_per_person, reset_day) VALUES
  ('22222222-0000-0000-0000-000000000002', 4, 2, true, true, false, true, 1);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. PROFESOR LÍDER
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_lead boolean NOT NULL DEFAULT false;

-- Mark Jonathan as lead teacher
UPDATE teachers SET is_lead = true WHERE id = '468968b1-4c0a-4759-af4e-4f63ac67eabf';

-- ═══════════════════════════════════════════════════════════════════════
-- 5. SESIONES DE COACHING (profe↔profe)
-- ═══════════════════════════════════════════════════════════════════════

-- New class type for coaching sessions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'coaching'
                 AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'class_type')) THEN
    ALTER TYPE class_type ADD VALUE 'coaching';
  END IF;
END $$;

-- Teacher being coached in a coaching session
ALTER TABLE classes ADD COLUMN IF NOT EXISTS coaching_teacher_id uuid REFERENCES teachers(id);

-- Coaching flag for explicit queries
ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_coaching boolean NOT NULL DEFAULT false;

-- Index for coaching lookups
CREATE INDEX IF NOT EXISTS idx_classes_coaching ON classes (coaching_teacher_id) WHERE is_coaching = true;

COMMIT;
