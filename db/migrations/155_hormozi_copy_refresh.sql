-- Fase 2a Hormozi (2026-11-08) — refresh de copies de mayor volumen
--
-- Gelfis 2026-11-08: tras análisis de volumen 30 días (~1186 sent + 12392
-- failed por kill switch v5), identificamos los 5 templates de WhatsApp
-- que cubren ~80% del tráfico útil:
--   1. chain4_absent_nodeposit sub_n=1 (rescate T+20min, no depósito)
--   2. chain4_absent_deposit  sub_n=1 (rescate T+20min, con Reserva Prioritaria)
--   3. chain4_absent          sub_n=2 (rescate T+24h — "¿te agendo esta semana?")
--   4. chain4_absent          sub_n=3 (rescate T+3d — último suave)
--   5. chain1_attended        sub_n=2 (refuerzo +24h tras oferta)
--
-- Cambios aplicados:
--   - Elimina {profe} de TODOS (feedback Gelfis — no mencionar profes)
--   - Elimina {meta} de todos los chain4_absent (el lead NO asistió al
--     trial, así que no hay meta discutida con el profe — era una fuga).
--   - chain4_absent sub_n=2 pasa a *clarifying question* (Hormozi: 60%
--     de las "no-asistencias" esconden una objeción no logística).
--   - chain1_attended sub_n=2 pasa a *clarifying question* igual.
--
-- Apply con client_encoding='UTF8' (regla de 100_wa_copy_refresh_no_scarcity.sql).
-- Rollback: `git revert` de este commit + re-aplicar el SQL de versiones anteriores.

-- ── chain4_absent_nodeposit sub_n=1 (primer rescate, sin depósito) ───
UPDATE message_templates
   SET body = E'¡{nombre}! Te esperábamos en tu clase y no coincidimos — ¿todo bien? 😊\n\nCero problema, pasa en las mejores familias. Cuando te encaje, eliges nuevo horario aquí en 1 minuto: {link_reagenda}\n\nSi fue solo agenda, con eso lo resolvemos. Si pasó algo más, dime y lo vemos.',
       placeholders = ARRAY['nombre','link_reagenda'],
       updated_at = NOW()
 WHERE kind = 'chain4_absent_nodeposit' AND sub_n = 1 AND channel = 'whatsapp';

-- ── chain4_absent_deposit sub_n=1 (primer rescate, con Reserva Prioritaria) ──
UPDATE message_templates
   SET body = E'¡{nombre}! Te esperábamos en tu clase y no coincidimos — ¿todo bien? 😊\n\nCero problema. Tu Reserva Prioritaria sigue 100% válida 🌟 — cuando te encaje, eliges nuevo horario aquí: {link_reagenda}\n\nSi fue solo agenda, con 1 minuto lo resolvemos. Si pasó algo más, dime y lo vemos.',
       placeholders = ARRAY['nombre','link_reagenda'],
       updated_at = NOW()
 WHERE kind = 'chain4_absent_deposit' AND sub_n = 1 AND channel = 'whatsapp';

-- ── chain4_absent sub_n=2 (T+24h) — clarifying question ──
UPDATE message_templates
   SET body = E'{nombre}, me quedo con la duda: ¿fue solo cuestión de agenda, o algo más te hizo pensar en si realmente este programa es para ti?\n\nPregunto directo porque a veces una duda chica frena todo, y prefiero saberlo yo a que te quedes con ella.\n\nSi fue solo agenda, aquí eliges nuevo horario: {link_reagenda}',
       placeholders = ARRAY['nombre','link_reagenda'],
       updated_at = NOW()
 WHERE kind = 'chain4_absent' AND sub_n = 2 AND channel = 'whatsapp';

-- ── chain4_absent sub_n=3 (T+3d) — último suave ──
UPDATE message_templates
   SET body = E'{nombre}, sin presión — quedo pendiente por si quieres retomar cuando te encaje 📅\n\nAquí el link para elegir horario: {link_reagenda}\n\nSi no, nada: te deseo éxitos con tu alemán 🍀',
       placeholders = ARRAY['nombre','link_reagenda'],
       updated_at = NOW()
 WHERE kind = 'chain4_absent' AND sub_n = 3 AND channel = 'whatsapp';

-- ── chain1_attended sub_n=2 (refuerzo +24h) — clarifying question ──
UPDATE message_templates
   SET body = E'{nombre}, un dato rápido: empezando esta semana llegas a {meta} en {fecha_llegada} 📅 — cada semana que pasa, esa fecha se mueve.\n\nTe pregunto directo: ¿hay algo concreto que te esté frenando para decidir? A veces es una duda chica que en 2 minutos resolvemos.',
       placeholders = ARRAY['nombre','meta','fecha_llegada'],
       updated_at = NOW()
 WHERE kind = 'chain1_attended' AND sub_n = 2 AND channel = 'whatsapp';
