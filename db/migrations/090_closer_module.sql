-- 090_closer_module.sql
-- Modulo CRM Closer: rol, tablas de cadencia, tareas, acciones, ventas,
-- comisiones, config y ranking.

BEGIN;

-- 1. Ampliar enum user_role
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'closer';

COMMIT;

-- Nuevas columnas y tablas van en su propia transaccion porque
-- ADD VALUE en un enum no puede ir en la misma TX que lo usa.
BEGIN;

-- 2. Nuevas columnas en leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS closer_id              UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS estado_cierre           TEXT NOT NULL DEFAULT 'sin_asignar',
  ADD COLUMN IF NOT EXISTS motivo_perdido          TEXT,
  ADD COLUMN IF NOT EXISTS fecha_asignacion_closer TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_closer_id ON leads(closer_id) WHERE closer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_estado_cierre ON leads(estado_cierre);

-- 3. Nueva columna en users para rango
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rango TEXT;

-- 4. config_cadencia — pasos de la cadencia de seguimiento
CREATE TABLE IF NOT EXISTS config_cadencia (
  id         SERIAL PRIMARY KEY,
  tipo       TEXT    NOT NULL CHECK (tipo IN ('tipo_a', 'tipo_b')),
  paso       INT     NOT NULL,
  dias_offset INT    NOT NULL,
  canal      TEXT    NOT NULL CHECK (canal IN ('whatsapp', 'llamada', 'email')),
  plantilla  TEXT    NOT NULL,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo, paso)
);

ALTER TABLE config_cadencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_cadencia_service ON config_cadencia
  FOR ALL USING (true) WITH CHECK (true);

-- Seed Tipo A (lead asistio a trial): 5 pasos en 30 dias
INSERT INTO config_cadencia (tipo, paso, dias_offset, canal, plantilla) VALUES
  ('tipo_a', 1, 0,  'whatsapp', 'Hola {{nombre}}, fue un placer conocerte en la clase de prueba. ¿Te quedo alguna duda sobre los packs?'),
  ('tipo_a', 2, 1,  'llamada',  'Llamada de seguimiento: resolver dudas y confirmar interes'),
  ('tipo_a', 3, 3,  'whatsapp', '{{nombre}}, queria recordarte que tu lugar sigue reservado. ¿Necesitas que te explique algo mas sobre el programa?'),
  ('tipo_a', 4, 7,  'email',    'Resumen de beneficios y enlace de inscripcion'),
  ('tipo_a', 5, 30, 'llamada',  'Ultimo contacto del mes: verificar si aun hay interes o cerrar')
ON CONFLICT (tipo, paso) DO NOTHING;

-- Seed Tipo B (lead NO asistio a trial): 4 pasos en 12 dias
INSERT INTO config_cadencia (tipo, paso, dias_offset, canal, plantilla) VALUES
  ('tipo_b', 1, 0,  'whatsapp', 'Hola {{nombre}}, vimos que no pudiste asistir a tu clase de prueba. ¿Te gustaria reagendar?'),
  ('tipo_b', 2, 1,  'llamada',  'Llamada: ofrecer nueva fecha de trial'),
  ('tipo_b', 3, 3,  'whatsapp', '{{nombre}}, aun tienes disponible tu clase de prueba gratuita. ¿Que dia te viene mejor?'),
  ('tipo_b', 4, 12, 'llamada',  'Ultimo intento de reagendar trial')
ON CONFLICT (tipo, paso) DO NOTHING;

-- 5. tareas_closer — tareas generadas por el motor de cadencia
CREATE TABLE IF NOT EXISTS tareas_closer (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closer_id         UUID        NOT NULL REFERENCES users(id),
  lead_id           UUID        NOT NULL REFERENCES leads(id),
  paso              INT         NOT NULL,
  tipo              TEXT        NOT NULL CHECK (tipo IN ('tipo_a', 'tipo_b')),
  canal             TEXT        NOT NULL CHECK (canal IN ('whatsapp', 'llamada', 'email')),
  plantilla         TEXT        NOT NULL,
  fecha_programada  TIMESTAMPTZ NOT NULL,
  fecha_completada  TIMESTAMPTZ,
  resultado         TEXT CHECK (resultado IS NULL OR resultado IN (
    'contactado', 'no_contesto', 'no_interesado', 'reagendado', 'venta'
  )),
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tareas_closer_closer_id ON tareas_closer(closer_id);
CREATE INDEX IF NOT EXISTS idx_tareas_closer_lead_id ON tareas_closer(lead_id);
CREATE INDEX IF NOT EXISTS idx_tareas_closer_pending ON tareas_closer(closer_id, fecha_programada)
  WHERE fecha_completada IS NULL;

ALTER TABLE tareas_closer ENABLE ROW LEVEL SECURITY;
CREATE POLICY tareas_closer_service ON tareas_closer
  FOR ALL USING (true) WITH CHECK (true);

-- 6. acciones_closer — registro de acciones manuales del closer
CREATE TABLE IF NOT EXISTS acciones_closer (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closer_id   UUID        NOT NULL REFERENCES users(id),
  lead_id     UUID        NOT NULL REFERENCES leads(id),
  tipo        TEXT        NOT NULL CHECK (tipo IN ('llamada', 'whatsapp', 'email', 'nota', 'otro')),
  contenido   TEXT,
  resultado   TEXT,
  duracion_seg INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acciones_closer_closer_id ON acciones_closer(closer_id);
CREATE INDEX IF NOT EXISTS idx_acciones_closer_lead_id ON acciones_closer(lead_id);

ALTER TABLE acciones_closer ENABLE ROW LEVEL SECURITY;
CREATE POLICY acciones_closer_service ON acciones_closer
  FOR ALL USING (true) WITH CHECK (true);

-- 7. ventas — solicitudes de venta pendientes de aprobacion
CREATE TABLE IF NOT EXISTS ventas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID        NOT NULL REFERENCES leads(id),
  solicitado_por   UUID        NOT NULL REFERENCES users(id),
  rol_solicitante  TEXT        NOT NULL CHECK (rol_solicitante IN ('teacher', 'closer')),
  pack_id          TEXT,
  payment_type     TEXT,
  monto_cents      INT,
  moneda           TEXT        NOT NULL DEFAULT 'EUR',
  estado           TEXT        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  aprobado_por     UUID        REFERENCES users(id),
  aprobado_at      TIMESTAMPTZ,
  motivo_rechazo   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_ventas_lead_id ON ventas(lead_id);

ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
CREATE POLICY ventas_service ON ventas
  FOR ALL USING (true) WITH CHECK (true);

-- 8. config_rangos — umbrales de rango para profesores y closers
CREATE TABLE IF NOT EXISTS config_rangos (
  id               SERIAL PRIMARY KEY,
  rol              TEXT        NOT NULL CHECK (rol IN ('teacher', 'closer')),
  rango            TEXT        NOT NULL,
  comision_pct     NUMERIC(5,2) NOT NULL,
  min_close_rate   NUMERIC(5,2) NOT NULL DEFAULT 0,
  min_conversiones INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rol, rango)
);

ALTER TABLE config_rangos ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_rangos_service ON config_rangos
  FOR ALL USING (true) WITH CHECK (true);

-- Seed rangos profesor
INSERT INTO config_rangos (rol, rango, comision_pct, min_close_rate, min_conversiones) VALUES
  ('teacher', 'starter', 5,   0,  0),
  ('teacher', 'pro',     8,  25, 15),
  ('teacher', 'elite',  12,  35, 30),
  ('teacher', 'master', 15,  45, 50)
ON CONFLICT (rol, rango) DO NOTHING;

-- Seed rangos closer
INSERT INTO config_rangos (rol, rango, comision_pct, min_close_rate, min_conversiones) VALUES
  ('closer', 'rookie',  8,   0,  0),
  ('closer', 'closer', 10,  20, 20),
  ('closer', 'elite',  12,  30, 40),
  ('closer', 'master', 15,  40, 60)
ON CONFLICT (rol, rango) DO NOTHING;

-- 9. config_comisiones — parametros globales del sistema de comisiones
CREATE TABLE IF NOT EXISTS config_comisiones (
  id          SERIAL PRIMARY KEY,
  clave       TEXT        UNIQUE NOT NULL,
  valor       NUMERIC(10,4) NOT NULL,
  descripcion TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE config_comisiones ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_comisiones_service ON config_comisiones
  FOR ALL USING (true) WITH CHECK (true);

INSERT INTO config_comisiones (clave, valor, descripcion) VALUES
  ('bonus_rescate_closer',        3,    'Porcentaje extra cuando closer convierte lead que no asistio a trial'),
  ('factor_profe_precalificacion', 0.5, 'Factor multiplicador de comision del profe cuando closer cierra la venta'),
  ('pool_maximo',                 18,   'Porcentaje maximo del valor de la venta que se puede repartir en comisiones')
ON CONFLICT (clave) DO NOTHING;

-- 10. comisiones — registro de comisiones pagadas por venta
CREATE TABLE IF NOT EXISTS comisiones (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id            UUID        NOT NULL REFERENCES ventas(id),
  usuario_id          UUID        NOT NULL REFERENCES users(id),
  rol                 TEXT        NOT NULL CHECK (rol IN ('teacher', 'closer')),
  tipo                TEXT        NOT NULL CHECK (tipo IN ('comision_base', 'bono_rescate', 'comision_precalificacion')),
  monto_cents         INT         NOT NULL,
  porcentaje_aplicado NUMERIC(5,2),
  porcentaje_teorico  NUMERIC(5,2),
  pool_cap_aplicado   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comisiones_venta_id ON comisiones(venta_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_usuario_id ON comisiones(usuario_id);

ALTER TABLE comisiones ENABLE ROW LEVEL SECURITY;
CREATE POLICY comisiones_service ON comisiones
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
