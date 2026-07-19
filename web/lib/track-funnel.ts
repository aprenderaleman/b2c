/**
 * Helper client-side para trackear pasos del funnel.
 *
 * Gelfis 2026-07-19: instrumentación granular para ver dónde se pierden
 * los leads en el flow (landings → CTA → slot picker → form → submit).
 *
 * Reutiliza la tabla `funnel_progress` (ya existente para el quiz
 * Diagnostico) añadiendo códigos de step nuevos (10-16) que no colisionan
 * con los legacy (1-6).
 *
 * Dedup: cada evento (session_id + step) solo se envía UNA vez por
 * sesión — así el usuario que rebota entre pasos no infla la BD.
 *
 * Fire-and-forget: los `sendBeacon` no bloquean el UI. Si falla, se
 * pierde el evento — trade-off aceptado por simplicidad.
 */

// Códigos de step legacy (1-6) reservados para el quiz Diagnostico.
// Códigos nuevos (10+) para la instrumentación del flow landing → trial:
export const FUNNEL_STEP = {
  // legacy — respetados por compatibilidad
  motivo:            1,
  nivel:             2,
  form_opened:       3,
  field_typed:       4,
  submit_attempt:    5,
  submit_ok:         6,
  // nuevos — landing + slot picker
  landing_view:      10,
  cta_click:         11,
  slot_page_view:    12,
  day_picked:        13,
  slot_picked:       14,
  phone_valid:       15,
  commitment_checked: 16,
} as const;

export type FunnelStepKey = keyof typeof FUNNEL_STEP;

const SESSION_COOKIE = "aa_session_id";
const DEDUP_KEY_PREFIX = "aa_track_";

/**
 * Genera (o recupera) un session_id persistente para el visitante.
 * Cookie sin httpOnly (cliente lo lee), 30 días. Se comparte entre
 * subdominios de aprender-aleman.de si algún día montamos wildcard.
 */
function getSessionId(): string {
  if (typeof document === "undefined") return "";
  const existing = document.cookie
    .split(";")
    .map(c => c.trim())
    .find(c => c.startsWith(SESSION_COOKIE + "="));
  if (existing) return existing.slice(SESSION_COOKIE.length + 1);
  // crypto.randomUUID disponible en todos los navegadores modernos con secure context
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  const maxAge = 30 * 24 * 3600;
  document.cookie = `${SESSION_COOKIE}=${uuid}; path=/; max-age=${maxAge}; samesite=lax`;
  return uuid;
}

/**
 * Fire-and-forget: dispara un evento del funnel. Idempotente por sesión
 * — la 2a vez que el mismo usuario dispara el mismo step no hace nada.
 *
 * @param step Nombre del step (typed).
 * @param opts Info adicional para persistir:
 *   - answer: campo libre (ej. slug de landing, motivo elegido, error).
 *   - landingIntent: slug del landing origen (persistido para segmentar).
 */
export function trackFunnel(
  step: FunnelStepKey,
  opts?: { answer?: string; landingIntent?: string },
): void {
  if (typeof window === "undefined") return;
  const sessionId = getSessionId();
  if (!sessionId) return;

  const stepCode = FUNNEL_STEP[step];
  const dedupKey = `${DEDUP_KEY_PREFIX}${sessionId.slice(0, 8)}_${stepCode}`;
  try {
    if (sessionStorage.getItem(dedupKey)) return; // ya disparado en esta sesión
    sessionStorage.setItem(dedupKey, "1");
  } catch { /* ignore */ }

  const payload = JSON.stringify({
    session_id:     sessionId,
    step:           stepCode,
    answer:         opts?.answer ?? null,
    landing_intent: opts?.landingIntent ?? null,
  });

  // sendBeacon primero (no bloquea, sobrevive navigate). Fallback a fetch.
  try {
    if ("sendBeacon" in navigator) {
      const blob = new Blob([payload], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/public/track-funnel", blob);
      if (ok) return;
    }
  } catch { /* fallthrough */ }

  try {
    fetch("/api/public/track-funnel", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    payload,
      keepalive: true,
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
}
