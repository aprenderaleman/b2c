-- 098_closer_panel_v1.sql
-- Fase 1 del panel /closer: corregir schema tareas_closer,
-- añadir flujo_activo, preparar ofertas para closer, etc.

BEGIN;

-- 1. Corregir tareas_closer.tipo: el chain-engine inserta valores
--    que el CHECK original no contemplaba (seguimiento_post, etc.)
ALTER TABLE tareas_closer DROP CONSTRAINT IF EXISTS tareas_closer_tipo_check;
ALTER TABLE tareas_closer ADD CONSTRAINT tareas_closer_tipo_check
  CHECK (tipo IN (
    'tipo_a', 'tipo_b',
    'seguimiento_post', 'llamada_rescate', 'llamada_objecion',
    'seguimiento_absent', 'inbound_response', 'reactivacion',
    'seguimiento_fecha', 'llamada_post_venta'
  ));

-- 2. Añadir columnas que el chain-engine ya intentaba escribir
ALTER TABLE tareas_closer
  ADD COLUMN IF NOT EXISTS prioridad TEXT DEFAULT 'media'
    CHECK (prioridad IN ('alta', 'media', 'baja')),
  ADD COLUMN IF NOT EXISTS fecha_vence TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'cadencia'
    CHECK (origen IN ('cadencia', 'chain', 'manual', 'inbound'));

-- 3. Ampliar resultado para incluir 'buzon'
ALTER TABLE tareas_closer DROP CONSTRAINT IF EXISTS tareas_closer_resultado_check;
ALTER TABLE tareas_closer ADD CONSTRAINT tareas_closer_resultado_check
  CHECK (resultado IS NULL OR resultado IN (
    'contactado', 'no_contesto', 'buzon', 'no_interesado', 'reagendado', 'venta'
  ));

-- 4. Ampliar acciones_closer.tipo para resultados Capa 1
ALTER TABLE acciones_closer DROP CONSTRAINT IF EXISTS acciones_closer_tipo_check;
ALTER TABLE acciones_closer ADD CONSTRAINT acciones_closer_tipo_check
  CHECK (tipo IN (
    'llamada', 'whatsapp', 'email', 'nota', 'otro',
    'contactado', 'no_contesto', 'buzon', 'reagendado', 'venta',
    'no_interesado', 'mensaje_enviado'
  ));

-- 5. Columnas extra en acciones_closer para objeciones y motivos
ALTER TABLE acciones_closer
  ADD COLUMN IF NOT EXISTS objection_chip TEXT,
  ADD COLUMN IF NOT EXISTS motivo_no_interesado TEXT;

-- 6. Toggle flujo de leads por closer
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS flujo_activo BOOLEAN DEFAULT TRUE;

-- 7. Preparar ofertas_enviadas para closer
ALTER TABLE ofertas_enviadas
  ADD COLUMN IF NOT EXISTS closer_id UUID REFERENCES users(id);

ALTER TABLE ofertas_enviadas
  ALTER COLUMN teacher_id DROP NOT NULL;

-- 8. Timestamp del último mensaje automático enviado (para R4)
ALTER TABLE lead_chains
  ADD COLUMN IF NOT EXISTS last_auto_sent_at TIMESTAMPTZ;

-- 9. Columnas de reactivación en leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reactivation_source TEXT,
  ADD COLUMN IF NOT EXISTS reactivation_batch_id UUID;

COMMIT;
