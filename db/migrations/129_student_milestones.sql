-- ⚠️ IMPORTANTE: aplicar con client_encoding='UTF8'.
-- =============================================================================
-- Migration 129 — Hitos de clases restantes (10 / 5 / 0) + relabel garantías
-- =============================================================================
-- Gelfis 2026-09-21:
--   * Tres mensajes automáticos de Stiv (email + WhatsApp) cuando al alumno
--     le quedan 10, 5 y 0 clases. Se envían desde el cron pack-alerts y se
--     registran en student_milestones para no repetirlos nunca.
--   * Al llegar a 0 el alumno se da de baja automáticamente (cron).
--   * Los certificados de Garantía de Nivel ya emitidos se relabelan con la
--     meta actual del alumno (A2 / B1 / B2 / C1 / Fluidez Total (A1→B1)).
--     El PDF se regenera al descargarlo desde esta metadata; NO se reenvía
--     ningún email (guard garantia_email_sent_at).
-- =============================================================================

BEGIN;

-- ── 1. Registro de hitos enviados ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_milestones (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    milestone   int         NOT NULL,                 -- 10 | 5 | 0 (clases restantes)
    remaining   int         NOT NULL,                 -- valor real en el momento del envío
    email_ok    boolean     NOT NULL DEFAULT false,
    whatsapp_ok boolean     NOT NULL DEFAULT false,
    sent_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (student_id, milestone)
);
CREATE INDEX IF NOT EXISTS student_milestones_student_idx ON student_milestones(student_id);

-- ── 2. Plantillas editables (admin → /admin/mensajes) ───────────────────────
-- Variables: {nombre} {meta} {total} {restantes}
INSERT INTO message_templates (kind, sub_n, channel, body, name, active) VALUES
  ('pack_milestone', 10, 'whatsapp',
   E'¡{nombre}! 🎯 Ya solo te quedan 10 clases para llegar a tu meta {meta}.\nEstás llegando a la meta — ¡sigue así! Cada clase que das ahora es la que más se nota.\n— Stiv · Aprender-Aleman.de',
   'Hito · 10 clases restantes', true),
  ('pack_milestone', 5, 'whatsapp',
   E'¡{nombre}! Solo 5 sesiones más y lo tienes 💪\nEstás a un paso de tu meta {meta}. ¿Listo/a para continuar con el siguiente nivel? Respóndeme aquí y te cuento cómo seguimos sin perder el ritmo.\n— Stiv · Aprender-Aleman.de',
   'Hito · 5 clases restantes', true),
  ('pack_milestone', 0, 'whatsapp',
   E'¡FELICIDADES, {nombre}! 🎉 Lo has logrado: has completado tus {total} clases y has llegado a tu meta {meta}.\nEso no lo hace cualquiera — constancia pura.\n¿Seguimos con el siguiente nivel? Respóndeme y lo dejamos listo.\n— Stiv · Aprender-Aleman.de',
   'Hito · 0 clases (meta cumplida)', true),

  ('pack_milestone', 10, 'email',
   E'Estás llegando a la meta, ¡sigue así!|||Ya solo te quedan 10 clases para llegar a tu meta {meta}.\nEstás llegando a la meta — ¡sigue así! Cada clase que das ahora es la que más se nota.',
   'Hito · 10 clases restantes (email: asunto|||cuerpo)', true),
  ('pack_milestone', 5, 'email',
   E'Solo 5 sesiones más, casi lo tienes|||Solo 5 sesiones más y lo tienes.\nEstás a un paso de tu meta {meta}. ¿Listo/a para continuar con el siguiente nivel? Escríbeme y te cuento cómo seguimos sin perder el ritmo.',
   'Hito · 5 clases restantes (email: asunto|||cuerpo)', true),
  ('pack_milestone', 0, 'email',
   E'¡Felicidades, lo has logrado! 🎉|||Lo has logrado: has completado tus {total} clases y has llegado a tu meta {meta}.\nEso no lo hace cualquiera — constancia pura.\n¿Seguimos con el siguiente nivel? Escríbeme y lo dejamos listo.',
   'Hito · 0 clases (email: asunto|||cuerpo)', true)
ON CONFLICT (kind, sub_n, channel) DO UPDATE
   SET body = EXCLUDED.body, name = EXCLUDED.name, active = true, updated_at = NOW();

-- ── 3. Relabel de las garantías ya emitidas con la meta actual del alumno ───
UPDATE certificates c
   SET description = (
         CASE s.goal
           WHEN 'a1_a2'         THEN 'A2'
           WHEN 'b1'            THEN 'B1'
           WHEN 'b2'            THEN 'B2'
           WHEN 'c1'            THEN 'C1'
           WHEN 'fluidez_total' THEN 'Fluidez Total (A1→B1)'
           ELSE split_part(COALESCE(c.description, ''), ' · ', 1)
         END
       ) || ' · ' || COALESCE(NULLIF(split_part(COALESCE(c.description, ''), ' · ', 2), ''), 'Pago único')
  FROM students s
 WHERE s.id = c.student_id
   AND c.type = 'garantia_nivel';

COMMIT;
