-- ⚠️ IMPORTANTE: esta migración contiene UTF-8 (¡, ¿, —, emojis, tildes).
-- Debe aplicarse con client_encoding='UTF8'. Ver nota en migración 100.
--
-- 107: Fixes de copy (auditoría Gelfis 2026-08-14) + cadenas de Sesión
-- de Plan (sesion_attended / sesion_absent).
--
-- Fixes:
--   1. chain3_obj_pareja paso 1: la línea "Precio: {ritmo_recomendado}"
--      imprimía el NOMBRE del ritmo donde iba el precio. Se elimina la
--      línea (el precio vive en el link) y también el bonus del copy
--      base (AUTHORING_RULES: sin escasez inventada — el bonus solo en
--      variantes _bonus_vivo).
--   2. chain2 paso 1: usaba {ritmo_recomendado} (el de la cualificación)
--      pudiendo contradecir el ritmo ELEGIDO en el modal. Pasa a {ritmo}
--      (elegido, con fallback al recomendado).
--   3. chain2 paso 4: "hoy vence tu reserva ... hasta las 23:59" era
--      escasez inventada. Se reemplaza por CTA de ayuda + llamada.
--
-- Cadenas de sesión: gemelas de chain1/chain4 pero sin {profe}, hablando
-- de "Sesión de Plan" y reagendando hacia /sesion-plan ({link_sesion}).

BEGIN;

-- ── Fix 1: chain3_obj_pareja paso 1 ─────────────────────────────────
UPDATE message_templates
   SET body = E'¡Perfecto que lo hablen juntos, {nombre}! 👫 Te preparo un resumen para que se lo enseñes tal cual:\n📋 Tu plan: {meta} con {ritmo_recomendado}\n📋 Garantía de Nivel POR ESCRITO: si cumples y no llegas, clases gratis hasta lograrlo\n📋 Tu fecha de llegada: {fecha_llegada}\n📋 Precios y ritmos: {link_inscripciones}',
       updated_at = NOW()
 WHERE kind = 'chain3_obj_pareja' AND sub_n = 1 AND channel = 'whatsapp';

-- ── Fix 2: chain2 paso 1 — ritmo elegido, no el recomendado ─────────
UPDATE message_templates
   SET body = E'¡{nombre}, gran decisión! 🎉 Aquí tienes tu inscripción: {ritmo} → llegas a {meta} en {fecha_llegada}.\n👉 {link_pago}\nCualquier duda durante el proceso, aquí estoy 😊',
       updated_at = NOW()
 WHERE kind = 'chain2_link_sent' AND sub_n = 1 AND channel = 'whatsapp';

-- ── Fix 3: chain2 paso 4 — sin escasez inventada ────────────────────
UPDATE message_templates
   SET body = E'{nombre}, ¿te ayudo a dejarlo listo? El enlace sigue activo 👉 {link_pago}\nY si prefieres resolverlo hablando, dime y te llamamos 📞',
       updated_at = NOW()
 WHERE kind = 'chain2_link_sent' AND sub_n = 4 AND channel = 'whatsapp';

-- ── Cadena SESIÓN — ASISTIÓ (T+2h / +24h / +3d / +7d) ───────────────
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('sesion_attended', 1, 'whatsapp',
 'Sesión asistió · Paso 1 (T+2h)',
 'Lead asistió a su Sesión de Plan. Primer follow-up de Stiv.',
 E'¡{nombre}! 😊 Gracias por la Sesión de Plan de hoy — quedó claro tu camino hacia {meta} 💪\nTu plan recomendado: {ritmo_recomendado} → llegas a {meta} en {fecha_llegada}.\nY con tu inscripción activas la Garantía de Nivel por escrito.\n👉 {link_inscripciones}',
 ARRAY['nombre','meta','ritmo_recomendado','fecha_llegada','link_inscripciones']),

('sesion_attended', 2, 'whatsapp',
 'Sesión asistió · Paso 2 (T+24h)',
 'Urgencia real por fecha de llegada.',
 E'Oye {nombre}, un dato rápido: empezando esta semana, llegas a {meta} en {fecha_llegada} 📅. Cada semana que pasa, esa fecha se mueve.\n¿Tienes alguna duda que te pueda resolver?',
 ARRAY['nombre','meta','fecha_llegada']),

('sesion_attended', 3, 'whatsapp',
 'Sesión asistió · Paso 3 (T+3d)',
 'CTA de llamada con el asesor.',
 E'{nombre}, ¿lo miraste con calma? Si quieres, dame un rango horario y tu asesor te llama 5 min para resolver cualquier duda 📞\n👉 {link_inscripciones}',
 ARRAY['nombre','link_inscripciones']),

('sesion_attended', 4, 'whatsapp',
 'Sesión asistió · Paso 4 (T+7d) — cierre suave',
 'Despedida. Lead pasa a en_reactivacion.',
 E'Te dejo tranquilo/a 😊 Tu plan queda guardado y las puertas abiertas. Si algo cambia, me escribes y lo retomamos donde lo dejamos. ¡Éxitos con tu alemán! 🍀',
 ARRAY['nombre'])
ON CONFLICT (kind, sub_n, channel) DO UPDATE
   SET body = EXCLUDED.body, active = true, updated_at = NOW();

-- ── Cadena SESIÓN — NO ASISTIÓ (T+20min / +24h / +3d) ───────────────
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('sesion_absent', 1, 'whatsapp',
 'Sesión no asistió · Paso 1 (T+20min)',
 'No asistió a su Sesión de Plan. Rescate inmediato sin reproche.',
 E'¡{nombre}! Te esperamos en tu Sesión de Plan — ¿todo bien? 😊 Cero problema, pasa en las mejores familias. Reagenda aquí en 1 minuto y armamos tu plan hacia {meta}: {link_sesion}',
 ARRAY['nombre','meta','link_sesion']),

('sesion_absent', 2, 'whatsapp',
 'Sesión no asistió · Paso 2 (T+24h)',
 'Recordatorio de valor + reagenda.',
 E'{nombre}, ¿agendamos tu Sesión de Plan esta semana? 📅 Son 20 minutos por videollamada y sales con tu plan hacia {meta} — con fechas y precio claros. Elige aquí: {link_sesion}',
 ARRAY['nombre','meta','link_sesion']),

('sesion_absent', 3, 'whatsapp',
 'Sesión no asistió · Paso 3 (T+3d) — cierre suave',
 'Último toque. Lead pasa a en_reactivacion.',
 E'{nombre}, sin presión — quedo pendiente si quieres retomar tu Sesión de Plan cuando te encaje 📅 Aquí el link para elegir horario: {link_sesion}',
 ARRAY['nombre','link_sesion'])
ON CONFLICT (kind, sub_n, channel) DO UPDATE
   SET body = EXCLUDED.body, active = true, updated_at = NOW();

COMMIT;
