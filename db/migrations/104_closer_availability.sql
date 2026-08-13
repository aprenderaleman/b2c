-- ============================================================
-- 104: Disponibilidad semanal de closers
--
-- Espejo de teacher_availability (012) pero ligada a users(id)
-- porque los closers no tienen tabla de perfil propia.
--
-- Uso hoy: "Mi disponibilidad" en /closer/disponibilidad.
-- Uso futuro (Gelfis 2026-08-06): funnel para que los leads
-- agenden sesiones con closers según estas franjas.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS closer_availability (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    closer_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 0 = domingo, 1 = lunes, … 6 = sábado (igual que JS getDay)
    day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),

    start_time    TIME NOT NULL,
    end_time      TIME NOT NULL CHECK (end_time > start_time),

    available     BOOLEAN NOT NULL DEFAULT TRUE,

    valid_from    DATE,
    valid_until   DATE,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS closer_availability_closer_idx
  ON closer_availability(closer_id, day_of_week, start_time);

ALTER TABLE closer_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY closer_availability_service ON closer_availability
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
