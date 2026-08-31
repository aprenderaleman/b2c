-- 124: registro de aceptación de Términos y Condiciones en el checkout
--
-- FASE 2 legal (Linguify Global LLC, TyC condiciones-es-v2.0 vigentes
-- 2026-09-01). Dos cláusulas exigen prueba de consentimiento por
-- alumno en el momento del pago:
--   §10.2 — consentimiento expreso de inicio inmediato del servicio
--           dentro de la ventana de desistimiento de 14 días (sin él,
--           el plazo se extiende por ley hasta 12 meses).
--   §17.5 — silence rule: requiere saber contra qué terms_version se
--           notificó cada cambio futuro.
--
-- Una fila por Checkout Session creada desde /pago/{ofertaId}. El
-- consentimiento real (checkbox de Stripe) llega por webhook
-- checkout.session.completed → session.consent.terms_of_service y se
-- vuelca en tos_consent / accepted_at. El checkbox de Stripe cubre
-- TyC + §10.2 porque el custom_text mostrado junto a él incluye la
-- solicitud de inicio inmediato.

CREATE TABLE IF NOT EXISTS terms_acceptances (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id                 uuid REFERENCES leads(id)    ON DELETE SET NULL,
    student_id              uuid REFERENCES students(id) ON DELETE SET NULL,
    oferta_id               uuid,
    email                   text,
    terms_version           text NOT NULL,
    terms_url               text NOT NULL,
    checkout_visited_at     timestamptz NOT NULL DEFAULT now(),
    ip                      text,
    user_agent              text,
    stripe_session_id       text,
    -- 'accepted' cuando Stripe reporta el checkbox marcado; null si la
    -- session nunca se completó o el consent no vino en el evento.
    tos_consent             text,
    -- true = el custom_text mostrado incluía la cláusula §10.2 de
    -- inicio inmediato y el checkbox fue aceptado.
    immediate_start_consent boolean NOT NULL DEFAULT false,
    accepted_at             timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS terms_acceptances_session_idx ON terms_acceptances(stripe_session_id);
CREATE INDEX IF NOT EXISTS terms_acceptances_lead_idx    ON terms_acceptances(lead_id);
CREATE INDEX IF NOT EXISTS terms_acceptances_oferta_idx  ON terms_acceptances(oferta_id);
