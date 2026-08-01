-- ═══════════════════════════════════════════════
-- Templates para cadenas 8A-8G del closer (Fase 4)
-- Editables desde /admin/mensajes
-- ═══════════════════════════════════════════════

-- CADENA 8A — AGENDAR CLASE
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain8a_agendar', 1, 'whatsapp',
 'Cadena 8A · Seguimiento agendamiento (T+24h)',
 'Recordatorio tras agendar nueva clase.',
 E'¡Hola {nombre}! 😊 Solo confirmando: tu clase con {profe} sigue en pie. ¿Todo bien para asistir? Cualquier cambio me dices y lo reagendamos al instante 👉 {link_agenda}',
 ARRAY['nombre','profe','link_agenda'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- CADENA 8B — NO CONTESTÓ
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain8b_no_contesto', 1, 'whatsapp',
 'Cadena 8B · Paso 1 (T+4h)',
 'Primer reintento tras no contestar.',
 E'¡{nombre}! Intenté llamarte hace un rato 📞 ¿Te va mejor que hablemos por aquí? Quería contarte las opciones para arrancar con tu {meta} 💪',
 ARRAY['nombre','meta']),

('chain8b_no_contesto', 2, 'whatsapp',
 'Cadena 8B · Paso 2 (T+24h)',
 'Segundo intento + tarea closer.',
 E'¡Hola {nombre}! 😊 Sigo pendiente de ayudarte con tu alemán. {profe} me comentó que la clase fue genial — solo falta elegir tu plan y empezar.\n¿Te llamo hoy o prefieres que te mande la info por aquí?',
 ARRAY['nombre','profe']),

('chain8b_no_contesto', 3, 'whatsapp',
 'Cadena 8B · Paso 3 (T+3d) — cierre suave',
 'Último intento. Si no responde → reactivación.',
 E'Última de mi parte, {nombre} 😊 Tu diagnóstico y tu plaza quedan guardados. Cuando el momento sea el correcto, me escribes y retomamos donde lo dejamos. ¡Éxitos! 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- CADENA 8C — ENVIAR INFO
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain8c_info', 1, 'whatsapp',
 'Cadena 8C · Seguimiento info (T+24h)',
 'Seguimiento tras enviar info de cursos.',
 E'¡{nombre}! ¿Pudiste revisar la info que te mandé? 😊 Si tienes alguna duda sobre los ritmos o los precios, aquí estoy para resolverla.\nRecuerda que puedes ver todo en detalle aquí 👉 {link_inscripciones}',
 ARRAY['nombre','link_inscripciones'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- CADENA 8D — PROPUESTA ENVIADA
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain8d_propuesta', 1, 'whatsapp',
 'Cadena 8D · Seguimiento propuesta (T+24h)',
 'Seguimiento tras enviar propuesta con ritmo.',
 E'¡{nombre}! ¿Qué te pareció la propuesta del {ritmo}? 😊 Con ese ritmo tu {meta} llega en {fecha_llegada}.\n¿Tienes alguna pregunta? Aquí estoy para resolverla 💪',
 ARRAY['nombre','ritmo','meta','fecha_llegada']),

('chain8d_propuesta', 2, 'whatsapp',
 'Cadena 8D · Paso 2 (T+3d)',
 'Segundo seguimiento propuesta.',
 E'¡Hola {nombre}! Solo un recordatorio: la propuesta del {ritmo} ({precio_ritmo}) sigue disponible.\nSi prefieres otro ritmo o tienes dudas, dime y lo ajustamos a lo que mejor te funcione 😊',
 ARRAY['nombre','ritmo','precio_ritmo']),

('chain8d_propuesta', 3, 'whatsapp',
 'Cadena 8D · Paso 3 (T+5d) — cierre suave',
 'Último seguimiento. Si no responde → reactivación.',
 E'Te dejo tranquilo/a, {nombre} 😊 Tu propuesta queda guardada y las puertas abiertas. Cuando el momento sea el correcto, me escribes y empezamos de inmediato. ¡Éxitos con tu alemán! 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- CADENA 8E — SEGUIMIENTO CON FECHA
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain8e_seguimiento', 1, 'whatsapp',
 'Cadena 8E · Confirmación seguimiento (T+0)',
 'Confirmación del seguimiento programado.',
 E'¡Perfecto {nombre}! Queda agendado, te contacto en la fecha que acordamos 😊 Mientras tanto, si surge alguna duda, me escribes sin problema 💪',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- CADENA 8G — REACTIVACIÓN
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain8g_reactivacion', 1, 'whatsapp',
 'Cadena 8G · Reactivación paso 1 (T+0)',
 'Primer contacto de reactivación.',
 E'¡Hola {nombre}! 😊 Ha pasado un tiempo desde que hablamos de tu alemán. ¿Sigues con ganas de lograr tu {meta}?\nTenemos nuevas opciones y horarios — dime si quieres que te cuente las novedades 💪',
 ARRAY['nombre','meta']),

('chain8g_reactivacion', 2, 'whatsapp',
 'Cadena 8G · Reactivación paso 2 (T+4d)',
 'Segundo contacto reactivación. Si no responde → fin.',
 E'Última de mi parte, {nombre} 😊 Tu diagnóstico sigue guardado y tu plaza disponible. Cuando quieras retomar, un mensaje y arrancamos. ¡Éxitos! 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;
