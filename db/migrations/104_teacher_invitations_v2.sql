-- 104: Rediseño invitación de profesores (Gelfis 2026-08-02)
--
-- La invitación pasa de "link pelado" a formulario completo: el admin
-- fija las condiciones (tarifa individual, rango de comisión, trials)
-- al invitar y estas se aplican al perfil al completarse el registro.
-- El profe NUNCA edita sus condiciones.
--
-- También: TTL pasa de 7 → 14 días, y el registro captura timezone +
-- franjas de disponibilidad orientativas.

-- ── teacher_invitations: condiciones acordadas ─────────────────────
ALTER TABLE teacher_invitations
  ADD COLUMN IF NOT EXISTS name                 TEXT,
  ADD COLUMN IF NOT EXISTS rate_individual_eur  NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS rango                TEXT NOT NULL DEFAULT 'starter'
    CHECK (rango IN ('starter','pro','elite','master')),
  ADD COLUMN IF NOT EXISTS accepts_trials       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_sent_at         TIMESTAMPTZ;

-- TTL 14 días para invitaciones nuevas (las viejas conservan su expiry)
ALTER TABLE teacher_invitations
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '14 days');

-- ── teachers: zona horaria + disponibilidad orientativa ────────────
-- availability_prefs es orientativa (mañanas/tardes/noches/findes);
-- la disponibilidad fina vive en teacher_availability y la configura
-- el profe en su panel después del alta.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS timezone           TEXT,
  ADD COLUMN IF NOT EXISTS availability_prefs TEXT[] NOT NULL DEFAULT '{}';
