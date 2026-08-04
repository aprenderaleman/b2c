-- ⚠️ IMPORTANTE: esta migración contiene UTF-8 (¡, ¿, —, emojis, tildes).
-- Debe aplicarse con client_encoding='UTF8'. En psycopg2:
--   conn.set_client_encoding('UTF8')  ANTES del cur.execute().
-- En psql: `psql -v ON_ERROR_STOP=1 -f 100.sql` respeta LANG del env.
-- Sin esto Postgres almacena doble-codificación y los mensajes salen
-- con Â¡, ðŸ˜Š, Ã³ (mojibake). Bug reportado por Gelfis 2026-08-04
-- (Raúl y 9 leads más recibieron chain4_absent corrupto).
--
-- Refresh copies WhatsApp para cumplir la regla AUTHORING_RULES:
--   1. Prohibida la escasez inventada (cupos/cierres/liberar plazas).
--   2. Prohibidos binarios de salida ('dime NO').
--   3. Toda urgencia sale de variables reales ({dia_bonus} vivo/vencido, {fecha_llegada}).
--
-- Gelfis 2026-08-01 — spec del banner de reglas en message-catalog.ts.
-- Los 5 copies afectados viven en `message_templates` (fuente única para
-- los flows del motor lead_chains). Legacy TS eliminado en el mismo commit.

-- ── chain4_absent step 1: variante SIN depósito (base) ───────────────
UPDATE message_templates
   SET body = E'¡{nombre}! Te esperamos en tu clase — ¿todo bien? 😊 Cero problema, pasa en las mejores familias. {profe} guardó lo que preparó para tu clase de {meta} — reagenda aquí en 1 minuto: {url}',
       updated_at = NOW()
 WHERE kind = 'chain4_absent_nodeposit' AND sub_n = 1 AND channel = 'whatsapp';

-- ── chain4_absent step 1: variante CON depósito (dorada) ─────────────
UPDATE message_templates
   SET body = E'¡{nombre}! Te esperamos en tu clase — ¿todo bien? 😊 Cero problema, pasa en las mejores familias. {profe} guardó lo que preparó para tu clase de {meta} — reagenda aquí en 1 minuto: {url}\n\n…y tu Reserva Prioritaria sigue 100% válida 🌟',
       updated_at = NOW()
 WHERE kind = 'chain4_absent_deposit' AND sub_n = 1 AND channel = 'whatsapp';

-- ── chain4_absent step 2: T+24h suave ────────────────────────────────
UPDATE message_templates
   SET body = E'{nombre}, ¿te agendo la clase esta semana? 📅 {profe} sigue con tu slot preparado para tu clase de {meta}. Elige aquí: {url}',
       updated_at = NOW()
 WHERE kind = 'chain4_absent' AND sub_n = 2 AND channel = 'whatsapp';

-- ── chain4_absent step 3: T+3d último toque suave (cierra en_reactivacion) ─
UPDATE message_templates
   SET body = E'{nombre}, sin presión — quedo pendiente si quieres retomar tu clase de {meta} cuando te encaje 📅 Aquí el link para elegir horario: {url}',
       updated_at = NOW()
 WHERE kind = 'chain4_absent' AND sub_n = 3 AND channel = 'whatsapp';

-- ── chain1_attended step 5: post_trial_final (cierra en_reactivacion +30d) ─
UPDATE message_templates
   SET body = E'{nombre}, no quiero bombardearte — este es mi último recordatorio 😊 Recuerda lo importante: tu programa incluye la Garantía de Nivel POR ESCRITO, y empezando esta semana tu {meta} llega en {fecha_llegada} 📅 Te guardo tus condiciones una semana. Si prefieres hablarlo en una llamada rápida, dime y te llamamos 📞',
       updated_at = NOW()
 WHERE kind = 'chain1_attended' AND sub_n = 5 AND channel = 'whatsapp';

-- Nota: `chain5_reschedule` sub_n=1 se reserva para el mensaje de
-- CONFIRMACIÓN de nueva fecha (otro flow, no follow-up). El copy de
-- `reschedule_followup_24h` (follow-up +24h sin rebook) se cambia
-- inline en el cron `reschedule-followup/route.ts` porque ese flujo
-- aún vive fuera del motor de cadenas.
