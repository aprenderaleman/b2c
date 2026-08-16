-- ============================================================
-- 116: semaforo_transitions — fotografía append-only del color
--
-- El semáforo se calcula SIEMPRE on-read (lib/semaforo.ts) y nunca
-- se persiste como columna editable. Esta tabla es la única
-- excepción acordada (Gelfis 2026-08-16): el cron observador
-- (cada 10 min, solo observa — nunca actúa sobre leads) registra
-- cada CAMBIO de color/regla para poder medir "tiempo promedio en
-- rojo (7d)" — LA métrica de salud del tablero admin — y explicar
-- transiciones pasadas en disputas de comisión.
--
-- Append-only por diseño: ningún endpoint la edita ni borra.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS semaforo_transitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  prev_color   TEXT,
  color        TEXT NOT NULL CHECK (color IN ('rojo', 'amarillo', 'verde', 'fuera')),
  regla        TEXT,
  causa        TEXT,
  badge        TEXT,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semtrans_lead
  ON semaforo_transitions(lead_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_semtrans_recent
  ON semaforo_transitions(detected_at DESC);

ALTER TABLE semaforo_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY semaforo_transitions_service ON semaforo_transitions
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
