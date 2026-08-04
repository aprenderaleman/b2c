-- Fix Gelfis 2026-08-04: copies chain1_attended sin duplicaciones + bono
-- separado en variante bonus_vivo (AUTHORING_RULES: escasez real, no inventada).
--
-- Cambios:
--   1. Sub_n=1 base: sin mención al bono. Copy limpio, sin "tu {meta}" ni
--      "ritmo {ritmo_recomendado}" (evita duplicación con los fallbacks).
--   2. Nueva variante chain1_attended_bonus_vivo sub_n=1 CON mención al bono.
--      Solo se sirve cuando chainMeta.bonus_activo === true.
--   3. Sub_n=2: mismo estilo — "llegas a {meta}" en vez de "tu {meta} llega".
--   4. Sub_n=3 base: reemplaza el "vence HOY" del bono con un CTA de llamada.
--   5. Nueva variante chain1_attended_bonus_vivo sub_n=3 CON el "vence hoy".
--   6. Sub_n=5: corrigen caracteres corruptos (â€” → —, ðŸ˜Š → 😊, etc).

-- ─── Sub_n=1 base (sin bono) ───────────────────────────────────────
UPDATE message_templates
   SET body = E'¡{nombre}! 😊 {profe} me contó que tuviste una gran clase — dice que tienes base de sobra para lograr {meta} 💪\nTu plan recomendado: {ritmo_recomendado} → llegas a {meta} en {fecha_llegada}.\nY con tu inscripción activas tu Garantía de Nivel por escrito.\n👉 {link_inscripciones}',
       updated_at = NOW()
 WHERE kind = 'chain1_attended' AND sub_n = 1 AND channel = 'whatsapp';

-- ─── Sub_n=1 variante bonus_vivo (con bono real activo) ────────────
INSERT INTO message_templates (kind, sub_n, channel, body, name, active)
VALUES (
  'chain1_attended_bonus_vivo', 1, 'whatsapp',
  E'¡{nombre}! 😊 {profe} me contó que tuviste una gran clase — dice que tienes base de sobra para lograr {meta} 💪\nTu plan recomendado: {ritmo_recomendado} → llegas a {meta} en {fecha_llegada}.\nY recuerda: si te inscribes antes de {dia_bonus}, te llevas una clase extra de regalo (vale 40€) 🎁\n👉 {link_inscripciones}',
  'Chain1 attended · sub 1 · bono vivo',
  true
)
ON CONFLICT (kind, sub_n, channel) DO UPDATE
   SET body = EXCLUDED.body, active = true, updated_at = NOW();

-- ─── Sub_n=2 base ───────────────────────────────────────────────────
UPDATE message_templates
   SET body = E'Oye {nombre}, un dato rápido: empezando esta semana, llegas a {meta} en {fecha_llegada} 📅. Cada semana que pasa, esa fecha se mueve.\n¿Tienes alguna duda que te pueda resolver?',
       updated_at = NOW()
 WHERE kind = 'chain1_attended' AND sub_n = 2 AND channel = 'whatsapp';

-- ─── Sub_n=3 base (sin bono, CTA llamada) ──────────────────────────
UPDATE message_templates
   SET body = E'{nombre}, ¿lo miraste con calma? Si quieres, dame un rango horario y te llamo 5 min para responder cualquier duda 📞\n👉 {link_inscripciones}',
       updated_at = NOW()
 WHERE kind = 'chain1_attended' AND sub_n = 3 AND channel = 'whatsapp';

-- ─── Sub_n=3 variante bonus_vivo (bono real vence hoy) ─────────────
INSERT INTO message_templates (kind, sub_n, channel, body, name, active)
VALUES (
  'chain1_attended_bonus_vivo', 3, 'whatsapp',
  E'{nombre}, tu bono de clase extra vence hoy 🎁 Si te sirve, aquí lo tienes:\n👉 {link_inscripciones}\nY si prefieres una llamada de 5 min, dime hueco horario.',
  'Chain1 attended · sub 3 · bono vence hoy',
  true
)
ON CONFLICT (kind, sub_n, channel) DO UPDATE
   SET body = EXCLUDED.body, active = true, updated_at = NOW();

-- ─── Sub_n=5 recuperar copy con caracteres correctos ───────────────
UPDATE message_templates
   SET body = E'{nombre}, no quiero bombardearte — este es mi último recordatorio 😊 Recuerda lo importante: tu programa incluye la Garantía de Nivel POR ESCRITO, y empezando esta semana llegas a {meta} en {fecha_llegada} 📅 Te guardo tus condiciones una semana. Si prefieres hablarlo en una llamada rápida, dime y te llamamos 📞',
       updated_at = NOW()
 WHERE kind = 'chain1_attended' AND sub_n = 5 AND channel = 'whatsapp';
