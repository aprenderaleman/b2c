/**
 * Copys de la campaña Deutsch im Sommer (Gelfis 2026-06-19).
 *
 * Opción A (Gelfis 2026-06-19): UN solo msg 1 para todos los niveles —
 * no se diferencia por A0/A1/A2/B1/B2/C1. Saltos: 1 línea vacía entre
 * bloques (versión "tight" tras feedback Gelfis 2026-06-19).
 *
 * Fechas calendario fijas:
 *   msg 1 → sábado 20 jun 2026 desde 08:00 Berlin (gate en el cron)
 *   msg 2 → jueves 02 jul 2026 desde 08:00 Berlin
 *   msg 3 → viernes 04 jul 2026 desde 08:00 Berlin
 */

export type PromoStep = 1 | 2 | 3;

const LINK = "https://aprender-aleman.de/promo/verano-2026";

/** Mensaje 1 — presenta la promo. Mismo para todos. */
function renderMsg1(name: string): string {
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

/** Mensaje 2 — jueves 02 jul: "faltan solo 3 días". */
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

/** Mensaje 3 — viernes 04 jul: "último día". */
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

export function renderPromoMessage(step: PromoStep, name: string): string {
  if (step === 1) return renderMsg1(name);
  if (step === 2) return renderMsg2(name);
  return renderMsg3(name);
}

// ── Fechas calendario fijas ──────────────────────────────────────
// 8 AM Berlin en CEST verano = 06:00 UTC. Las usa el cron para gate.
export const MSG1_START_AT = Date.parse("2026-06-20T06:00:00Z");
export const MSG2_AT       = Date.parse("2026-07-02T06:00:00Z");
export const MSG3_AT       = Date.parse("2026-07-04T06:00:00Z");
