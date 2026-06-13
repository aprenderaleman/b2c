-- Migration 055: estado trial_attended
--
-- Cuando admin marca "✓ Asistió" el lead debe quedar con un estado
-- explícito (no caer a in_conversation genérico) para que en el
-- dashboard se vea claro que asistió y pueda revertirse.

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'trial_attended' AFTER 'trial_reminded';
