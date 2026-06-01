-- ============================================================
-- Migration 057 — Track cold-call status per lead
--
-- Gelfis pidió un check en /admin/leads/[id] para saber qué leads
-- ya recibieron llamada fría y cuáles siguen pendientes. Una sola
-- columna timestamp basta: NULL = pendiente, fecha = hecha (y nos
-- sirve para calcular "hace X días" en la UI).
--
-- También sirve como criterio futuro de queries para listar
-- leads pendientes de llamada en el dashboard.
-- ============================================================

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS cold_call_done_at TIMESTAMPTZ;

-- Índice parcial: la consulta típica es "leads SIN llamada fría",
-- así que indexamos solo los pendientes (filas con NULL). Para
-- el dashboard de tareas pendientes esto es instantáneo.
CREATE INDEX IF NOT EXISTS idx_leads_cold_call_pending
    ON leads(created_at DESC)
    WHERE cold_call_done_at IS NULL;
