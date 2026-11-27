-- ─────────────────────────────────────────────────────────────────────────
-- 166: Acuerdo de Colaboración con Closers (Gelfis 2026-11-27).
-- Mismo flujo que el de profesores (142/143), pero los closers no tienen
-- tabla propia: las columnas van en users con prefijo closer_.
-- Storage: materials/acuerdos-closers/<user_id>.pdf (+ -firmado.pdf);
-- la firma del admin se reutiliza de materials/firmas/<admin_user_id>.png.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS closer_agreement_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closer_agreement_version     TEXT,
  ADD COLUMN IF NOT EXISTS closer_agreement_path        TEXT,
  ADD COLUMN IF NOT EXISTS closer_agreement_signed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closer_agreement_signed_path TEXT,
  ADD COLUMN IF NOT EXISTS closer_agreement_received_at TIMESTAMPTZ;
