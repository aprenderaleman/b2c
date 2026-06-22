/**
 * Copys de la campaña Deutsch im Sommer (Gelfis 2026-06-19).
 *
 * 3 mensajes por nivel. Saltos de línea idénticos al template aprobado
 * A0/A1 — todos los niveles comparten estructura, sólo cambia la
 * "pregunta motivacional" de la línea 3.
 *
 * Niveles soportados: A0, A1, A2, B1, B2, C1 y `unknown` (versión
 * genérica que pide nivel + horario).
 */

export type PromoLevel = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "unknown";
export type PromoStep  = 1 | 2 | 3;

const PREGUNTA: Record<PromoLevel, string> = {
  A0: "¿qué piensas si llegas a septiembre finalmente hablando alemán básico con confianza?",
  A1: "¿qué piensas si llegas a septiembre finalmente hablando alemán básico con confianza?",
  A2: "¿qué piensas si llegas a septiembre manteniendo conversaciones cotidianas en alemán sin trabarte?",
  B1: "¿qué piensas si llegas a septiembre defendiéndote solo en una entrevista o gestión en alemán?",
  B2: "¿qué piensas si llegas a septiembre dominando el alemán profesional en reuniones y emails?",
  C1: "¿qué piensas si llegas a septiembre expresándote en alemán con naturalidad casi nativa?",
  unknown: "¿qué piensas si llegas a septiembre sintiendo que por fin avanzaste de verdad con el alemán?",
};

/** Mensaje 1 — presenta la promo. Saltos idénticos al template aprobado. */
function renderMsg1(name: string, level: PromoLevel): string {
  if (level === "unknown") {
    return [
      `¡Hola ${name}! `,
      ``,
      ``,
      `Pregunta rápida: ${PREGUNTA.unknown}`,
      ``,
      ``,
      `Promoción única de verano: Deutsch im Sommer ☀️`,
      `4 semanas intensivas por solo 150 € de pago único.`,
      `- Cupos muy limitados.`,
      `- Inscripciones abiertas hasta el 5 de julio`,
      ``,
      ``,
      `Si te interesa, dinos tu nivel y horario ideal:`,
      `   Nivel: A1 / A2 / B1 / B2 / C1`,
      `   Horario: ☀️ Mañana / 🌤️ Tarde / 🌙 Noche / 📅 Fin de semana`,
      ``,
      ``,
      ` Wir freuen uns auf dich!   `,
      ``,
      `Stiv | Aprender-Aleman.de`,
    ].join("\n");
  }
  return [
    `¡Hola ${name}! `,
    ``,
    ``,
    `Pregunta rápida: ${PREGUNTA[level]}`,
    ``,
    ``,
    `Promoción única de verano: Deutsch im Sommer ☀️`,
    `4 semanas intensivas por solo 150 € de pago único.`,
    `- Cupos muy limitados.`,
    `- Inscripciones abiertas hasta el 5 de julio`,
    ``,
    ``,
    `Si te interesa, dinos tu horario ideal:`,
    `   ☀️ Mañana / 🌤️ Tarde / 🌙 Noche / 📅 Fin de semana`,
    ``,
    ``,
    ` Wir freuen uns auf dich!   `,
    ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
}

/** Mensaje 2 — T+4d, "cupos acabándose". */
function renderMsg2(name: string): string {
  return [
    `¡Hola ${name}! `,
    ``,
    ``,
    `Te escribo rápido: Deutsch im Sommer ☀️ se está llenando — los cupos restantes los reservo por orden de respuesta.`,
    ``,
    ``,
    `4 semanas intensivas por 150 € de pago único.`,
    `- Cierre de inscripciones: 5 de julio.`,
    `- Cupos restantes: muy pocos.`,
    ``,
    ``,
    `Si quieres entrar, dime tu horario:`,
    `   ☀️ Mañana / 🌤️ Tarde / 🌙 Noche / 📅 Fin de semana`,
    ``,
    ``,
    `No quiero que pierdas el tren del verano.`,
    ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
}

/** Mensaje 3 — T+10d, "última oportunidad". */
function renderMsg3(name: string): string {
  return [
    `¡Hola ${name}! `,
    ``,
    ``,
    `Última llamada — Deutsch im Sommer ☀️ cierra inscripciones el 5 de julio.`,
    ``,
    ``,
    `4 semanas intensivas por 150 € de pago único. Después de esa fecha no podré reservarte un cupo.`,
    ``,
    ``,
    `Si quieres entrar:`,
    `   ☀️ Mañana / 🌤️ Tarde / 🌙 Noche / 📅 Fin de semana`,
    ``,
    ``,
    `Si no es tu momento, lo entiendo — gracias por considerarlo. 🙌`,
    ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
}

export function renderPromoMessage(
  step: PromoStep, name: string, level: PromoLevel,
): string {
  if (step === 1) return renderMsg1(name, level);
  if (step === 2) return renderMsg2(name);
  return renderMsg3(name);
}

/**
 * Normaliza el nivel del lead a una de las 7 keys soportadas. Lee de
 * `diagnostico_answers.level` (texto literal del quiz) y cae a
 * `german_level` (enum legacy). Devuelve "unknown" si nada matchea.
 */
export function normaliseLevel(
  diagAnswers: Record<string, unknown> | null | undefined,
  germanLevel: string | null | undefined,
): PromoLevel {
  const rawDiag = (diagAnswers?.level as string | undefined ?? "").toLowerCase();
  const rawEnum = (germanLevel ?? "").toLowerCase();

  if (rawDiag.startsWith("a0") || rawDiag.includes("cero") || rawEnum === "cero" || rawEnum === "a0") return "A0";
  if (rawDiag.startsWith("a1") || rawDiag.includes("básico") || rawDiag.includes("basico") || rawDiag.includes("a1-a2") || rawEnum === "a1") return "A1";
  if (rawDiag.startsWith("a2") || rawEnum === "a2") return "A2";
  if (rawDiag.startsWith("b1") || rawDiag.includes("intermedio") || rawDiag.includes("b1-b2") || rawEnum === "b1") return "B1";
  if (rawDiag.startsWith("b2") || rawEnum === "b2") return "B2";
  if (rawDiag.startsWith("c1") || rawEnum === "c1") return "C1";
  return "unknown";
}

/** Orden de prioridad para el cron (A0 primero, unknown último). */
export const LEVEL_PRIORITY: PromoLevel[] =
  ["A0", "A1", "A2", "B1", "B2", "C1", "unknown"];
