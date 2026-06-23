/**
 * Copys de la campaña Deutsch im Sommer (Gelfis 2026-06-19).
 *
 * Tras ban WA 2026-06-23: 3 variantes del msg 1 para diversificar el
 * patrón (Meta menos sensible si no es texto idéntico repetido). El
 * lead recibe siempre la misma variante (asignación determinística
 * por hash del id) para idempotencia.
 *
 * Fechas calendario:
 *   MSG1_START_AT → 2026-06-25 06:00 UTC (post-ban, miércoles 8 AM Berlin)
 *   MSG2_AT       → 2026-07-02 06:00 UTC
 *   MSG3_AT       → 2026-07-04 06:00 UTC
 */

export type PromoStep = 1 | 2 | 3;

const LINK = "https://aprender-aleman.de/promo/verano-2026";

// ── 3 variantes del msg 1 ────────────────────────────────────────
function msg1_v0(name: string): string {
  return [
    `¡Hola ${name}!`,
    ``,
    `Si aún mantienes el interés en aprender alemán pero lo sigues posponiendo, esta es tu oportunidad ideal.`,
    ``,
    `Promoción única de verano: Deutsch im Sommer ☀️`,
    `4 semanas intensivas por solo 150 € de pago único.`,
    `- Cupos muy limitados.`,
    `- Inscripciones abiertas hasta el 5 de julio`,
    ``,
    `Mira los detalles aquí:`,
    `👉 ${LINK}`,
    ``,
    `Wir freuen uns auf dich!`,
    ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
}

function msg1_v1(name: string): string {
  return [
    `Hola ${name}, ¿qué tal?`,
    ``,
    `Te escribo porque sé que llevabas tiempo dándole vueltas al alemán. Acabamos de abrir algo para este verano que puede ser justo lo que necesitas.`,
    ``,
    `Deutsch im Sommer ☀️ — 4 semanas intensivas, 150 € pago único.`,
    `Cupos limitados, inscripción hasta el 5 de julio.`,
    ``,
    `Te dejo los detalles:`,
    `👉 ${LINK}`,
    ``,
    `Cualquier cosa, aquí estoy.`,
    ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
}

function msg1_v2(name: string): string {
  return [
    `${name}, una propuesta rápida 👋`,
    ``,
    `Si el alemán sigue siendo un tema pendiente para ti, tenemos una promo de verano que merece que la veas.`,
    ``,
    `4 semanas intensivas. 150 € pago único. Pocos cupos.`,
    `Cierre de inscripciones: 5 de julio.`,
    ``,
    `Toda la info aquí:`,
    `👉 ${LINK}`,
    ``,
    `Si te encaja, dime y lo cerramos.`,
    ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
}

const MSG1_VARIANTS = [msg1_v0, msg1_v1, msg1_v2];

/**
 * Asigna determinísticamente una variante 0|1|2 a partir del lead id.
 * Garantiza que si reintentamos al mismo lead, recibe la misma variante
 * (idempotente — útil tras un retry tras ban).
 */
export function pickMsg1Variant(leadId: string): number {
  let hash = 0;
  for (let i = 0; i < leadId.length; i++) {
    hash = ((hash << 5) - hash + leadId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % MSG1_VARIANTS.length;
}

function renderMsg1(name: string, leadId: string): string {
  return MSG1_VARIANTS[pickMsg1Variant(leadId)](name);
}

/** Msg 2 — jueves 02 jul: "faltan solo 3 días". */
function renderMsg2(name: string): string {
  return [
    `¡Hola ${name}!`,
    ``,
    `Faltan solo 3 días — el sábado 5 de julio cierran las inscripciones de Deutsch im Sommer ☀️`,
    ``,
    `4 semanas intensivas por 150 € de pago único.`,
    `- Cierre: 5 de julio.`,
    `- Cupos restantes: muy pocos.`,
    ``,
    `Mira los detalles antes de que cierre:`,
    `👉 ${LINK}`,
    ``,
    `No quiero que pierdas el tren del verano.`,
    ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
}

/** Msg 3 — viernes 04 jul: "último día". */
function renderMsg3(name: string): string {
  return [
    `¡Hola ${name}!`,
    ``,
    `Último día — mañana sábado 5 de julio cierran las inscripciones de Deutsch im Sommer ☀️ y no se vuelve a abrir hasta el próximo verano.`,
    ``,
    `4 semanas intensivas por 150 € de pago único.`,
    ``,
    `Aquí los detalles:`,
    `👉 ${LINK}`,
    ``,
    `Si no es tu momento, lo entiendo — gracias por considerarlo. 🙌`,
    ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
}

export function renderPromoMessage(step: PromoStep, name: string, leadId: string): string {
  if (step === 1) return renderMsg1(name, leadId);
  if (step === 2) return renderMsg2(name);
  return renderMsg3(name);
}

// ── Fechas calendario fijas ──────────────────────────────────────
// Post-ban Gelfis 2026-06-23: MSG1_START_AT movido al miércoles 25 jun
// para dar 36h de margen tras el bloqueo de 24h. Si Gelfis quiere
// arrancar antes, editar aquí y push.
export const MSG1_START_AT = Date.parse("2026-06-25T06:00:00Z");
export const MSG2_AT       = Date.parse("2026-07-02T06:00:00Z");
export const MSG3_AT       = Date.parse("2026-07-04T06:00:00Z");
