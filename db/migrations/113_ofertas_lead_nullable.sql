-- 113: ofertas_enviadas.lead_id nullable (Gelfis 2026-08-21)
--
-- Unificación del sistema de balance: TODOS los estudiantes pasan a
-- tener oferta (fuente de clases_totales/clases_por_mes). Los legacy
-- importados nunca tuvieron lead → la oferta sintética va sin lead.
ALTER TABLE ofertas_enviadas ALTER COLUMN lead_id DROP NOT NULL;
