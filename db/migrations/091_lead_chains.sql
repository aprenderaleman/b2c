-- 091_lead_chains.sql
-- Motor de cadenas de mensajes post-trial.
--
-- Cada lead puede tener como máximo UNA cadena activa. Al iniciar una
-- nueva, la anterior se cierra con cancel_reason='new_chain'.
-- El cron /api/cron/chain-processor lee next_fire_at y avanza steps.

-- Nuevo status: en_reactivacion (lead que terminó la cadena sin pagar)
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'en_reactivacion' AFTER 'cold';

BEGIN;

CREATE TABLE IF NOT EXISTS lead_chains (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  chain_type    TEXT        NOT NULL,
  objection_chip TEXT,
  current_step  INT         NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_fire_at  TIMESTAMPTZ,
  paused_until  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  cancel_reason TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_chains_active
  ON lead_chains (lead_id) WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_chains_next_fire
  ON lead_chains (next_fire_at) WHERE completed_at IS NULL;

ALTER TABLE lead_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_chains_service ON lead_chains
  FOR ALL USING (true) WITH CHECK (true);

-- Seed: plantillas de cadenas en message_templates.
-- Todas editables desde /admin/mensajes sin tocar código.
-- Placeholders: {nombre}, {profe}, {meta}, {ritmo_recomendado},
-- {fecha_llegada}, {dia_bonus}, {link_inscripciones}, {link_pago}, {link_reagenda}

-- ═══════════════════════════════════════════════
-- CADENA 1 — ASISTIÓ (general)
-- ═══════════════════════════════════════════════
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain1_attended', 1, 'whatsapp',
 'Cadena 1 · Paso 1 (T+2h)',
 'Lead asistió sin objeción. Primer contacto Stiv.',
 E'¡{nombre}! 😊 {profe} me contó que tuviste una gran clase — dice que tienes base de sobra para lograr tu {meta} 💪\nTu plan recomendado: ritmo {ritmo_recomendado} → tu {meta} en {fecha_llegada}.\nY recuerda: si te inscribes antes del {dia_bonus}, te llevas una clase extra de regalo (vale 40€) 🎁\n👉 {link_inscripciones}',
 ARRAY['nombre','profe','meta','ritmo_recomendado','fecha_llegada','dia_bonus','link_inscripciones']),

('chain1_attended', 2, 'whatsapp',
 'Cadena 1 · Paso 2 (T+24h)',
 'Dato de urgencia temporal.',
 E'Oye {nombre}, un dato rápido: empezando esta semana, tu {meta} llega en {fecha_llegada} 📅. Cada semana que pasa, esa fecha se mueve.\n¿Tienes alguna duda que te pueda resolver?',
 ARRAY['nombre','meta','fecha_llegada']),

('chain1_attended', 3, 'whatsapp',
 'Cadena 1 · Paso 3 (T+47h)',
 'Último aviso del bonus.',
 E'¡Último aviso del regalo, {nombre}! 🎁 Tu clase extra gratis vence HOY. Después sigue tu plaza disponible, pero sin el bonus.\n¿Lo aprovechamos? 👉 {link_inscripciones}',
 ARRAY['nombre','link_inscripciones']),

('chain1_attended', 4, 'whatsapp',
 'Cadena 1 · Paso 4 (T+5d)',
 'Testimonio social proof.',
 E'{nombre}, te comparto algo real: uno de nuestros alumnos también dudó al principio — hoy va camino de su B1 con garantía por escrito. Si él pudo con trabajo y familia, tú también 😊 ¿Cómo lo ves?',
 ARRAY['nombre']),

('chain1_attended', 5, 'whatsapp',
 'Cadena 1 · Paso 5 (T+9d) — cierre suave',
 'Despedida. Lead pasa a en_reactivacion.',
 E'Te dejo tranquilo/a 😊 Tu diagnóstico queda guardado y las puertas abiertas. Si algo cambia, me escribes y retomamos donde lo dejamos. ¡Éxitos con tu alemán! 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- ═══════════════════════════════════════════════
-- CADENA 2 — ENLACE DE INSCRIPCIÓN ENVIADO
-- ═══════════════════════════════════════════════
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain2_link_sent', 1, 'whatsapp',
 'Cadena 2 · T+0 (envío enlace)',
 'Mensaje inmediato con el link de pago personalizado.',
 E'¡{nombre}, gran decisión! 🎉 Aquí tienes tu inscripción al programa {meta} con ritmo {ritmo_recomendado} — tu {meta} en {fecha_llegada}:\n👉 {link_pago}\nCualquier duda durante el proceso, aquí estoy 😊',
 ARRAY['nombre','meta','ritmo_recomendado','fecha_llegada','link_pago']),

('chain2_link_sent', 2, 'whatsapp',
 'Cadena 2 · Trigger +3h sin pago',
 'Check amable si el enlace funciona.',
 E'¿Todo bien con el enlace, {nombre}? 😊 Si algo no funciona o te surgió una duda de último momento, dime y lo resolvemos en 1 minuto.',
 ARRAY['nombre']),

('chain2_link_sent', 3, 'whatsapp',
 'Cadena 2 · Trigger +24h sin pago',
 'Plaza y bonus reservados.',
 E'{nombre}, tu plaza y tu bonus siguen reservados hasta el {dia_bonus} 🍀 ¿Hubo algo que te frenó? Dímelo con confianza — muchas veces es una duda de 2 minutos.',
 ARRAY['nombre','dia_bonus']),

('chain2_link_sent', 4, 'whatsapp',
 'Cadena 2 · Trigger +48h sin pago',
 'Última oportunidad. Alerta admin.',
 E'Última cosita, {nombre}: hoy vence tu reserva con las condiciones que hablamos. El enlace sigue activo hasta las 23:59 👉 {link_pago}\nY si prefieres hablarlo, dime y te llamamos 📞',
 ARRAY['nombre','link_pago'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- ═══════════════════════════════════════════════
-- CADENA 3 — ASISTIÓ CON OBJECIÓN (4 chips)
-- ═══════════════════════════════════════════════

-- CHIP: PRECIO
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain3_obj_precio', 1, 'whatsapp',
 'Cadena 3 Precio · Paso 1 (T+2h)',
 'Objeción precio: ofrecer ritmo más económico.',
 E'{nombre}, {profe} me contó de tu clase — ¡muy buen nivel! 💪 Y sé que el presupuesto pesa, es normal.\nPor eso existe nuestro ritmo Viajero: 240€/mes con 6 clases — avanzas a tu ritmo, sin frenarte 🚶\n¿Te lo muestro? 👉 {link_inscripciones}',
 ARRAY['nombre','profe','link_inscripciones']),

('chain3_obj_precio', 2, 'whatsapp',
 'Cadena 3 Precio · Paso 2 (T+2d)',
 'Garantía de nivel.',
 E'Y recuerda {nombre}: sea cual sea el ritmo, tu programa incluye la Garantía de Nivel por escrito — si cumples y no llegas, seguimos gratis hasta que lo tengas. El único escenario donde pierdes es no empezar 😊 ¿Alguna duda?',
 ARRAY['nombre']),

('chain3_obj_precio', 3, 'whatsapp',
 'Cadena 3 Precio · Paso 3 (T+5d) — cierre suave',
 'Cierre suave igual que Cadena 1.',
 E'Te dejo tranquilo/a 😊 Tu diagnóstico queda guardado y las puertas abiertas. Si algo cambia, me escribes y retomamos donde lo dejamos. ¡Éxitos con tu alemán! 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- CHIP: PENSARLO
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain3_obj_pensarlo', 1, 'whatsapp',
 'Cadena 3 Pensarlo · Paso 1 (T+24h)',
 'Ayudar a decidir preguntando qué frena.',
 E'¿Cómo lo ves, {nombre}? 😊 Solo por ayudarte a decidir: ¿lo que te hace dudar es el dinero, el tiempo, o si de verdad vas a conseguir el nivel? Según cuál sea, tengo respuesta para ti.',
 ARRAY['nombre']),

('chain3_obj_pensarlo', 2, 'whatsapp',
 'Cadena 3 Pensarlo · Paso 2 (T+47h)',
 'Bonus vence + link.',
 E'¡{nombre}! Tu clase de regalo vence hoy 🎁 Y un dato: empezando esta semana, tu {meta} llega en {fecha_llegada}. ¿Lo dejamos listo?\n👉 {link_inscripciones}',
 ARRAY['nombre','meta','fecha_llegada','link_inscripciones']),

('chain3_obj_pensarlo', 3, 'whatsapp',
 'Cadena 3 Pensarlo · Paso 3 (T+5d) — cierre suave',
 'Testimonio + cierre suave.',
 E'{nombre}, te comparto algo real: uno de nuestros alumnos también dudó al principio — hoy va camino de su B1 con garantía por escrito. Si él pudo con trabajo y familia, tú también 😊\nTe dejo tranquilo/a. Las puertas quedan abiertas. ¡Éxitos! 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- CHIP: PAREJA/FAMILIA
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain3_obj_pareja', 1, 'whatsapp',
 'Cadena 3 Pareja · Paso 1 (T+2h)',
 'Resumen para compartir con pareja.',
 E'¡Perfecto que lo hablen juntos, {nombre}! 👫 Te preparo un resumen para que se lo enseñes tal cual:\n📋 Tu plan: {meta} con ritmo {ritmo_recomendado}\n📋 Precio: {ritmo_recomendado}\n📋 Garantía de Nivel POR ESCRITO: si cumples y no llegas, clases gratis hasta lograrlo\n📋 Tu fecha de llegada: {fecha_llegada}\n📋 Bonus: clase extra gratis si se deciden antes del {dia_bonus} 🎁',
 ARRAY['nombre','meta','ritmo_recomendado','fecha_llegada','dia_bonus']),

('chain3_obj_pareja', 2, 'whatsapp',
 'Cadena 3 Pareja · Paso 2 (T+2d)',
 'Preguntar si pudieron hablarlo.',
 E'¿Pudieron hablarlo, {nombre}? 😊 Si a tu pareja le quedó alguna duda, con gusto se la respondo directamente — a veces ayuda escucharlo de nosotros.',
 ARRAY['nombre']),

('chain3_obj_pareja', 3, 'whatsapp',
 'Cadena 3 Pareja · Paso 3 (T+5d) — cierre suave',
 'Cierre suave.',
 E'Te dejo tranquilo/a 😊 Tu diagnóstico queda guardado y las puertas abiertas. Si algo cambia, me escribes y retomamos donde lo dejamos. ¡Éxitos con tu alemán! 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- CHIP: TIEMPO
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain3_obj_tiempo', 1, 'whatsapp',
 'Cadena 3 Tiempo · Paso 1 (T+24h)',
 'Flexibilidad de horarios.',
 E'Sobre el tiempo, {nombre}: son 2 horas a la semana en TUS horarios — mañanas, noches o findes. Y si un mes se complica, cambias de ritmo sin perder nada 🔄\nLa pregunta real: ¿dentro de 6 meses quieres tu {meta} o seguir igual?',
 ARRAY['nombre','meta']),

('chain3_obj_tiempo', 2, 'whatsapp',
 'Cadena 3 Tiempo · Paso 2 (T+47h)',
 'Bonus vence + link.',
 E'¡{nombre}! Tu clase de regalo vence hoy 🎁 Y un dato: empezando esta semana, tu {meta} llega en {fecha_llegada}. ¿Lo dejamos listo?\n👉 {link_inscripciones}',
 ARRAY['nombre','meta','fecha_llegada','link_inscripciones']),

('chain3_obj_tiempo', 3, 'whatsapp',
 'Cadena 3 Tiempo · Paso 3 (T+5d) — cierre suave',
 'Cierre suave.',
 E'Te dejo tranquilo/a 😊 Tu diagnóstico queda guardado y las puertas abiertas. Si algo cambia, me escribes y retomamos donde lo dejamos. ¡Éxitos con tu alemán! 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- ═══════════════════════════════════════════════
-- CADENA 4 — NO ASISTIÓ
-- ═══════════════════════════════════════════════
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain4_absent_deposit', 1, 'whatsapp',
 'Cadena 4 (depósito) · T+20min',
 'No asistió pero pagó Reserva Prioritaria.',
 E'¡{nombre}! Te esperamos en tu clase — ¿todo bien? 😊\nTranquilo/a: tu Reserva Prioritaria sigue 100% válida 🛡️ Solo dime qué día te viene mejor y te reagendo en 1 minuto 👉 {link_reagenda}',
 ARRAY['nombre','link_reagenda']),

('chain4_absent_nodeposit', 1, 'whatsapp',
 'Cadena 4 (sin depósito) · T+20min',
 'No asistió, sin depósito previo.',
 E'¡{nombre}! Te esperamos en tu clase — ¿todo bien? 😊\nCero problema, pasa en las mejores familias. Dime qué día te viene mejor y te reagendo en 1 minuto\n👉 {link_reagenda}',
 ARRAY['nombre','link_reagenda']),

('chain4_absent', 2, 'whatsapp',
 'Cadena 4 · T+24h',
 'Recordatorio reagendar.',
 E'¿Reagendamos, {nombre}? 📅 {profe} guardó lo que preparó para tu clase de {meta}. ¿Mañana o pasado? Tú eliges la hora 👉 {link_reagenda}',
 ARRAY['nombre','profe','meta','link_reagenda']),

('chain4_absent', 3, 'whatsapp',
 'Cadena 4 · T+3d — cierre suave',
 'Último mensaje. Marcar en_reactivacion.',
 E'Última de mi parte 😊 Tu plaza sigue disponible esta semana. Si la vida se cruzó, lo entiendo perfectamente — un mensaje y lo retomamos cuando quieras 🍀',
 ARRAY['nombre'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- ═══════════════════════════════════════════════
-- CADENA 5 — REPROGRAMAR
-- ═══════════════════════════════════════════════
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain5_reschedule', 1, 'whatsapp',
 'Cadena 5 · T+0 (confirmación nueva fecha)',
 'Confirmación de la nueva fecha reprogramada.',
 E'¡Listo, {nombre}! Tu clase quedó para el {nueva_fecha} a las {hora} con {profe} ✅ Ya está preparando la clase para tu {meta} 💪 ¡Nos vemos!',
 ARRAY['nombre','nueva_fecha','hora','profe','meta'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

-- ═══════════════════════════════════════════════
-- CADENA 6 — CANCELAR
-- ═══════════════════════════════════════════════
INSERT INTO message_templates (kind, sub_n, channel, name, description, body, placeholders) VALUES
('chain6_cancel', 1, 'whatsapp',
 'Cadena 6 · T+1h',
 'Confirmación cancelación + pregunta motivo.',
 E'Recibido, {nombre} — tu clase queda cancelada, sin ningún problema 😊\nSolo por mejorar: ¿fue tema de agenda o preferiste no hacerla por ahora?\nY cuando quieras retomar, reagendas aquí en 1 minuto: {link_reagenda}',
 ARRAY['nombre','link_reagenda']),

('chain6_cancel', 2, 'whatsapp',
 'Cadena 6 · T+7d — re-engagement',
 'Re-engagement suave. Marcar en_reactivacion.',
 E'¡Hola {nombre}! 😊 Por si el momento cambió: seguimos teniendo tu diagnóstico guardado y tu plaza disponible.\n¿Retomamos? 👉 {link_reagenda}',
 ARRAY['nombre','link_reagenda'])

ON CONFLICT (kind, sub_n, channel) DO NOTHING;

COMMIT;
