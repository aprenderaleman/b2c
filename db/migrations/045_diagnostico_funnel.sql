-- ============================================================
-- Migration 045: Diagnostico funnel (replaces /agendar at /)
-- ============================================================
--
-- El funnel nuevo en `/` (decisión Gelfis 2026-05-02) hace 4 preguntas
-- de quiz + captura de datos ANTES de mostrar el calendar de booking.
-- A diferencia del funnel viejo que solo guardaba al agendar, este
-- guarda el lead al completar el paso 5 — así no perdemos a quien
-- abandone en el paso 6.
--
-- Cambios:
--   1. Nuevo valor `'registered'` en `lead_status` — estado intermedio
--      entre 'new' y 'trial_scheduled'. Significa "completó quiz +
--      datos, todavía no agendó".
--   2. Nuevo valor `'personal_growth'` en `lead_goal` — opción nueva
--      del quiz ("Crecimiento personal"); no encaja con los valores
--      existentes.
--   3. Nuevo valor `'unsure'` en `german_level` — opción "No estoy
--      seguro" del quiz (paso 1).
--   4. Columna `country` — paso 5 lo pide explícitamente.
--   5. Columna `diagnostico_answers` JSONB — guarda las 4 respuestas
--      del quiz literales (sin pérdida por mapeo a enum) para
--      análisis y para mostrar el resumen en paso 6.
--   6. Columnas `diagnostico_completed_at` + `last_drip_msg_n` +
--      `last_drip_sent_at` — para que el cron de followups
--      (`/api/cron/diagnostico-followups`) sepa cuándo y qué mensaje
--      tocó la última vez y avance la secuencia hasta agendar o
--      cold-out.
--
-- Nota sobre ALTER TYPE: PostgreSQL exige que cada `ALTER TYPE ... ADD
-- VALUE` se ejecute en su propia transacción cuando hay otras DDL en
-- el batch. Supabase migrate corre cada archivo .sql en una sola
-- transacción por defecto, lo cual funciona aquí porque NO hay un
-- INSERT/SELECT del nuevo valor en el mismo archivo. Si el migrator
-- se queja, separar los ALTER TYPE en sus propios archivos.
-- ============================================================

ALTER TYPE lead_status  ADD VALUE IF NOT EXISTS 'registered';
ALTER TYPE lead_goal    ADD VALUE IF NOT EXISTS 'personal_growth';
ALTER TYPE german_level ADD VALUE IF NOT EXISTS 'unsure';

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS country                  TEXT,
    ADD COLUMN IF NOT EXISTS diagnostico_answers      JSONB,
    ADD COLUMN IF NOT EXISTS diagnostico_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_drip_msg_n          SMALLINT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_drip_sent_at        TIMESTAMPTZ;

-- Índice para el cron de followups: filtra leads en estado
-- 'registered' que aún no hayan recibido todos los mensajes y
-- ordena por antigüedad. Es un filtro pequeño en su mayoría.
CREATE INDEX IF NOT EXISTS idx_leads_diagnostico_drip
    ON leads (diagnostico_completed_at, last_drip_msg_n)
    WHERE status = 'registered';
