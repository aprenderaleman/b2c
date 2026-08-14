-- ⚠️ IMPORTANTE: aplicar con client_encoding='UTF8'.
--
-- Testimonios en audio de estudiantes reales (Gelfis 2026-08-14).
-- Se envían como social proof en las cadenas post-trial donde el lead
-- está evaluando (T+48h enlace sin pagar, objeciones específicas).
--
-- Todos los audios siguen la misma estructura de 3 preguntas:
--   1️⃣ ¿Cómo estabas con el alemán antes de empezar?
--   2️⃣ ¿Qué ha cambiado desde entonces?
--   3️⃣ ¿Qué le dirías a alguien que está dudando si empezar?
--
-- Duración variable — el copy NO menciona duración (spec Gelfis).

CREATE TABLE IF NOT EXISTS testimonials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_estudiante TEXT NOT NULL,
  audio_url         TEXT NOT NULL,               -- R2 URL (formato std b2c)
  audio_key         TEXT NOT NULL,               -- Key R2 para signed URL / delete
  meta_tag          TEXT NOT NULL DEFAULT 'general' CHECK (
    meta_tag IN ('general','work','studies','pareja','tiempo','precio','visa','travel','already_in_dach')
  ),
  transcripcion     TEXT,                        -- opcional, para búsqueda admin
  active            BOOLEAN NOT NULL DEFAULT true,
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_testimonials_active_tag
  ON testimonials (active, meta_tag) WHERE active = true;

-- Log de envíos (para no repetir el mismo testimonio al mismo lead)
CREATE TABLE IF NOT EXISTS testimonial_sends (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  testimonial_id UUID NOT NULL REFERENCES testimonials(id) ON DELETE CASCADE,
  lead_id        UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  chain_type     TEXT,                           -- e.g. 'chain2_link_sent'
  chain_step     INT,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (testimonial_id, lead_id)              -- no repetir el mismo audio al mismo lead
);

CREATE INDEX IF NOT EXISTS idx_testimonial_sends_lead
  ON testimonial_sends (lead_id, sent_at DESC);
