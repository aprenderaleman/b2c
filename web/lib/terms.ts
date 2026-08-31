/**
 * Versión vigente de los Términos y Condiciones (FASE 2 legal,
 * Linguify Global LLC). El identificador debe coincidir con el
 * `data-legal-version` que despliega aprender-aleman.de en sus páginas
 * legales — es la clave contra la que se registra cada aceptación
 * (terms_acceptances, migración 124) y contra la que se notificarán
 * modificaciones futuras (§17.5 silence rule).
 *
 * Al publicar una nueva versión de TyC: actualizar SOLO estas
 * constantes — el resto del pipeline (checkout, webhook) las arrastra.
 */

export const TERMS_VERSION = "condiciones-es-v2.0";
export const TERMS_URL     = "https://aprender-aleman.de/condiciones";

/**
 * Texto mostrado junto al checkbox de TyC en Stripe Checkout
 * (custom_text.terms_of_service_acceptance). Incluye la cláusula §10.2
 * de inicio inmediato: al marcar el checkbox el alumno acepta TyC Y
 * solicita expresamente el inicio del servicio dentro de la ventana de
 * desistimiento — ambos consentimientos quedan probados con el mismo
 * acto, registrado por Stripe y volcado a terms_acceptances vía
 * webhook. Límite de Stripe: 1200 caracteres.
 */
export const TERMS_CHECKOUT_TEXT =
  `Acepto los [Términos y condiciones](${TERMS_URL}) (${TERMS_VERSION}) de Linguify Global LLC y ` +
  `solicito expresamente que la prestación del servicio comience de inmediato ` +
  `(acceso a la plataforma y reserva de clases) antes de que finalice el plazo legal ` +
  `de desistimiento de 14 días. Sé que, si desisto dentro de ese plazo, abonaré la ` +
  `parte proporcional del servicio ya prestado, y que mi derecho de desistimiento se ` +
  `extingue cuando el servicio se haya ejecutado completamente.`;
