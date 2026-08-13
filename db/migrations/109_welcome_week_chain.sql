-- ⚠️ IMPORTANTE: aplicar con client_encoding='UTF8'.
--
-- Nueva cadena welcome_week (Gelfis 2026-08-14): secuencia de activación
-- de la primera semana post-conversión. Reemplaza el WA hardcoded
-- welcome_student de lead-conversion.ts (que sigue enviando el T+0
-- síncrono con el copy nuevo).
--
-- Steps del motor lead_chains:
--   sub_n=1 → T+0 (síncrono desde lead-conversion, motor arranca con skipFirstStep=true)
--   sub_n=2 → T+1d Hans (variante base + variante _celebration si ya usó Hans)
--   sub_n=3 → T+3d SCHULE (variante base + variante _celebration si ya usó SCHULE)
--   sub_n=4 → T+7d check-in con opciones 1/2/3
--   sub_n=5 → ACK respuesta "1" al check-in

INSERT INTO message_templates (kind, sub_n, channel, body, name, active) VALUES
  ('welcome_week', 1, 'whatsapp',
   E'¡{nombre}, BIENVENIDO/A a Aprender-Alemán! 🎉\nAcabas de dar el paso que separa a los que "quieren aprender alemán" de los que lo HABLAN. Esto es lo que acaba de pasar:\n✅ Tu programa {meta} está activo — llegas en {fecha_llegada} 📅\n✅ Tu Garantía de Nivel por escrito va en camino a tu email (revísalo 📩)\n✅ {profe} te escribirá hoy para fijar tus horarios\nTu único trabajo de hoy: revisa el email con tus accesos y entra a la plataforma 5 minutos. Mañana te mando tu primera misión 😉\nGelfis | Aprender-Aleman.de',
   'Welcome week · T+0 · bienvenida',
   true),

  ('welcome_week', 2, 'whatsapp',
   E'¡{nombre}! Tu primera misión 🎯 (2 minutos):\nTe presento a HANS, tu tutor personal de IA — disponible 24/7 para practicar conversación sin vergüenza y sin esperar a tu clase. Habla con él en español o alemán, como te salga.\n👉 {link_hans}\nPruébalo AHORA 5 minutos — pregúntale lo que quieras. Los alumnos que practican con Hans entre clases avanzan casi el doble de rápido. En serio 😊',
   'Welcome week · T+1d · Hans',
   true),

  ('welcome_week_celebration', 2, 'whatsapp',
   E'¡{nombre}! Vi que ya probaste Hans 🔥 Sigue así — practicar con él entre clases es lo que acelera el progreso. Cualquier duda que te salga, dispárasela a Hans o dímela a mí 😊',
   'Welcome week · T+1d · Hans (celebración si ya usó)',
   true),

  ('welcome_week', 3, 'whatsapp',
   E'¡{nombre}! Misión 2 🎯\nSCHULE es tu gimnasio de alemán: ejercicios de tu nivel con corrección instantánea, y cada uno suma a tu Garantía de Nivel (recuerda: 85% de ejercicios = garantía activa ✅).\n👉 {link_schule}\nEmpieza con el primer bloque de tu ruta — son 10 minutos y tu profesor verá tu progreso 💪',
   'Welcome week · T+3d · SCHULE',
   true),

  ('welcome_week_celebration', 3, 'whatsapp',
   E'¡{nombre}! Vi que ya arrancaste con SCHULE 💪 Cada ejercicio suma a tu Garantía de Nivel. Meta esta semana: 3 bloques más — te vas a sorprender de lo rápido que asienta la gramática.',
   'Welcome week · T+3d · SCHULE (celebración si ya usó)',
   true),

  ('welcome_week', 4, 'whatsapp',
   E'¡{nombre}! Primera semana completada 🙌 ¿Cómo te sientes? Respóndeme con total confianza:\n1️⃣ Todo genial, avanzando\n2️⃣ Bien, pero tengo alguna duda\n3️⃣ Necesito ayuda con algo\nTu respuesta me llega directo — y si todo va bien, solo celebra: la primera semana es la más difícil y ya la tienes 🎉',
   'Welcome week · T+7d · check-in 1/2/3',
   true),

  ('welcome_week', 5, 'whatsapp',
   E'¡Genial, {nombre}! 🎉 Sigue así — la constancia de la primera semana es la que marca el resto del camino. Cualquier cosa, aquí estoy.',
   'Welcome week · ack respuesta 1 al check-in',
   true)
ON CONFLICT (kind, sub_n, channel) DO UPDATE
   SET body = EXCLUDED.body, name = EXCLUDED.name, active = true, updated_at = NOW();

-- Config editable para el URL del video de bienvenida del fundador.
-- Vacío = el bloque de video no aparece en el email (no bloquear el deploy
-- esperando el asset). Se rellena por SQL una vez Gelfis grabe/hospede.
INSERT INTO system_config (key, value) VALUES
  ('url_video_bienvenida', '')
ON CONFLICT (key) DO NOTHING;
