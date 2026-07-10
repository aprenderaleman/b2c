-- 080_classes_soft_delete.sql
-- Gelfis 2026-07-10: soft-delete para classes.
--
-- Contexto (bug 2026-07-10): las trials de Ismael y Celia fueron
-- hard-deleted vía /api/admin/classes/[id]/permanent sin dejar rastro
-- en lead_timeline. Los leads quedaron con trial_scheduled_at seteado
-- pero sin fila en classes → /admin/funnel los mostraba "pendientes"
-- y el profe no las veía. Recuperamos manualmente reutilizando el
-- class_id original (para que los emails ya enviados sigan válidos).
--
-- Fix estructural:
--   1) Añadir columna `deleted_at` a classes.
--   2) TODAS las lecturas de classes filtran WHERE deleted_at IS NULL
--      (aplicado en un commit separado para no romper nada).
--   3) El endpoint /permanent ahora hace UPDATE deleted_at=NOW() en
--      vez de DELETE. Recuperación trivial: UPDATE ... SET deleted_at
--      = NULL WHERE id = ...
--   4) Guard rail: si is_trial=true, el endpoint /permanent rechaza —
--      trials se gestionan en /admin/clasedeprueba que sí loguea.

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Índice parcial — el 99.9% de queries buscan deleted_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_classes_active
  ON classes (scheduled_at DESC)
  WHERE deleted_at IS NULL;
