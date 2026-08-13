/**
 * Captura y propagación de atribución publicitaria (Google Ads + UTM).
 *
 * El flow del lead:
 *   1. Llega a una landing con ?gclid=… o ?utm_source=…
 *   2. captureAttributionFromUrl() lee la URL al montar y persiste en
 *      sessionStorage (sobrevive a navegaciones dentro del mismo tab).
 *   3. Cuando el lead llega al form (DiagnosticoFunnel o /agendar/cuando),
 *      readAttribution() lo recupera para enviarlo al endpoint.
 *
 * Por qué sessionStorage y no localStorage:
 *   - La atribución es de la sesión actual, no debe contaminar visitas
 *     futuras del mismo navegador (lead que vuelve por orgánico no debe
 *     llevar el gclid de su visita del mes pasado).
 *   - Sobrevive a window.location.href = ... (redirects internos).
 *
 * Por qué NO cookies o sessionStorage server-side:
 *   - El funnel es 100% client-rendered (no SSR vía cookies).
 *   - Mantenerlo client-only es más simple y suficiente para nuestro uso.
 */

const STORAGE_PREFIX = "b2c.attr.";

export type AttributionKey =
  | "gclid"       // Google Ads click ID
  | "gbraid"      // Google Brand iOS
  | "wbraid"      // Google Web iOS
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_term"
  | "utm_content"
  | "ref";        // código de referido de estudiante (sistema "Regala una clase")

const ALL_KEYS: AttributionKey[] = [
  "gclid", "gbraid", "wbraid",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref",
];

/**
 * Lee parámetros publicitarios de la URL actual y los persiste en
 * sessionStorage. Llamar al montar componentes que sean punto de
 * entrada del funnel (LandingStep0, DiagnosticoFunnel,
 * /agendar/cuando).
 *
 * Es idempotente: si ya hay un valor previo y el actual está vacío,
 * se preserva el previo (no pisamos atribución existente con vacíos).
 */
export function captureAttributionFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    for (const k of ALL_KEYS) {
      const v = params.get(k);
      if (v && v.trim()) {
        sessionStorage.setItem(`${STORAGE_PREFIX}${k}`, v.trim().slice(0, 200));
      }
    }
  } catch { /* sessionStorage puede estar bloqueado en modo incógnito */ }
}

/**
 * Devuelve los parámetros de atribución actuales (de sessionStorage).
 * Solo incluye los que tienen valor — claves vacías no aparecen.
 * Diseñado para spread directo dentro de un body JSON.
 */
export function readAttribution(): Partial<Record<AttributionKey, string>> {
  if (typeof window === "undefined") return {};
  const out: Partial<Record<AttributionKey, string>> = {};
  try {
    for (const k of ALL_KEYS) {
      const v = sessionStorage.getItem(`${STORAGE_PREFIX}${k}`);
      if (v) out[k] = v;
    }
  } catch { /* ignore */ }
  return out;
}

/**
 * Limpia toda la atribución almacenada. Llamar tras conversión final
 * (/confirmacion) para que una nueva sesión no herede el gclid viejo.
 */
export function clearAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    for (const k of ALL_KEYS) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${k}`);
    }
  } catch { /* ignore */ }
}
