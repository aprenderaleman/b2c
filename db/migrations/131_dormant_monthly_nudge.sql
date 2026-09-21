-- 131_dormant_monthly_nudge.sql
--
-- Template WA para el cron mensual de leads dormant (Gelfis 2026-09-21).
-- Se envía el día 1 de cada mes (con reintentos días 2 y 3) a leads
-- que llevan >30 días sin contacto y no convirtieron.

INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders, active)
VALUES (
  'dormant_monthly_nudge',
  1,
  'whatsapp',
  'Dormant lead — nudge mensual',
  'Ping mensual (día 1 de cada mes) a leads dormant sin conversión. Cron: dormant-monthly-nudge.',
  E'¡Hola {nombre}! 👋\n\nSigo por aquí — ¿te sigue rondando la idea de aprender alemán?\n\nSi quieres retomar, elige nueva clase de prueba:\n👉 {link_agenda}\n\nSi prefieres que no te escriba más, dímelo con un "no" y listo 😊\n\n— Stiv · Aprender-Aleman.de',
  ARRAY['nombre', 'link_agenda'],
  true
)
ON CONFLICT (kind, sub_n, channel) DO UPDATE
  SET body   = EXCLUDED.body,
      active = true;
