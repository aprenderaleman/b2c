-- Capa 1 — Anti-duplicate guard (Gelfis 2026-10-23).
--
-- Tras incidente del 23-oct donde 5 leads recibieron entre 11 y 28 veces
-- el mismo audio testimonial (96 mensajes duplicados en 72h, root cause en
-- chain-engine retry sin idempotencia por sub-envío) agregamos una capa
-- universal de deduplicación a nivel sendWhatsappText / sendWhatsappAudio.
--
-- Antes de cualquier envío, el helper computa:
--   hash = sha256(lead_phone + '|' + content_signature)
-- y consulta esta tabla. Si existe un envío con el mismo hash en las
-- últimas 24h, el envío se bloquea y se devuelve reason="recent_duplicate".
--
-- Es un guard independiente de la lógica de chain-engine — aunque haya un
-- bug nuevo que haga el retry duplicar, este guard lo frena antes.

CREATE TABLE IF NOT EXISTS whatsapp_sent_hashes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    TEXT        NOT NULL,
  content_hash  TEXT        NOT NULL,
  kind          TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para la query de dedupe (hash + ventana reciente).
CREATE INDEX IF NOT EXISTS idx_whatsapp_sent_hashes_lookup
  ON whatsapp_sent_hashes (content_hash, sent_at DESC);

-- Índice para purga de registros viejos.
CREATE INDEX IF NOT EXISTS idx_whatsapp_sent_hashes_sent_at
  ON whatsapp_sent_hashes (sent_at);

-- Nota: no agregamos TTL automático por ahora. Un cron de limpieza semanal
-- borra registros > 7 días (el guard solo mira 24h, así que 7d da margen).
