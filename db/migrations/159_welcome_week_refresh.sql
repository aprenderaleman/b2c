-- Gelfis 2026-11-15 — reescritura del Msg único WA de bienvenida
-- post-conversión. Después de este mensaje, silencio total en WA:
-- toda la comunicación con el estudiante se mueve a chat interno + email.
--
-- Cambios vs versión anterior (2026-08-14):
--   - Apertura "{nombre} es un placer darte la bienvenida oficial…"
--     (no "¡BIENVENIDO/A!").
--   - Elimina {meta}, {fecha_llegada}, {profe} del copy (eran fuentes
--     de fallos cuando el lead convierte sin trial o sin pack).
--   - Describe lo que el estudiante encuentra en la plataforma
--     (SCHULE, HANS, chat, plan de clases).
--   - Cierra explicitando "nos vemos por allí para no saturarte el
--     WhatsApp" — gestiona expectativa del canal.
--
-- Apply con client_encoding='UTF8' (regla 100_wa_copy_refresh).
-- Rollback: `git revert` + reaplicar el SQL anterior (109).

UPDATE message_templates
   SET body = E'{nombre}, es un placer darte la bienvenida oficial a la academia Aprender-Aleman.de 🎉\n\nAcabas de recibir por correo tus accesos y todas las instrucciones para empezar.\n\nEntra ahora a tu plataforma:\n👉 https://b2c.aprender-aleman.de\n\nAhí tienes todo esperándote:\n📚 SCHULE — tus lecciones y materiales\n🤖 HANS — tu asistente de alemán 24/7\n💬 Chat privado con tu profesor\n📅 Tu plan de clases\n\nEstá atento al chat: tu profesor/a te escribirá para agendar tu primera clase lo antes posible.\n\nA partir de aquí nos vemos por allí para no saturarte el WhatsApp 🙌\n\n¡Vamos a por el alemán! 💪',
       placeholders = ARRAY['nombre'],
       name = 'Welcome · bienvenida oficial (único WA post-conversión)',
       updated_at = NOW()
 WHERE kind = 'welcome_week' AND sub_n = 1 AND channel = 'whatsapp';
