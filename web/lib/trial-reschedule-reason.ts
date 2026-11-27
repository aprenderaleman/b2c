/**
 * Motivo del "Reagendar" del profe en una clase de prueba (Gelfis 2026-11-24).
 *
 * Regla: el profe puede reagendar por falta de confirmación SOLO si
 *   1. el lead no ha confirmado por ninguna vía (web, WhatsApp, setter ni
 *      al propio profe),
 *   2. el profe le envió su nota de voz antes de la clase y la marcó, y
 *   3. falta como mucho 1 hora para la clase (margen para que el lead
 *      conteste antes de perder el horario). Eran 2 h el primer día;
 *      Gelfis lo bajó a 1 h el 2026-11-24.
 * Si es el profe quien no puede dar la clase, lo indica con un motivo
 * escrito, que queda en el historial y avisa al admin; al lead solo se le
 * dice "por un imprevisto".
 *
 * Este archivo es puro (sin BD) para poder testearlo.
 */

// "lead_cancelo" (Gelfis 2026-11-27): el lead avisó al profe de que no
// puede venir — aunque hubiera confirmado. Sin ventana ni nota de voz;
// el profe escribe qué le dijo (solo lo ve la academia).
export type TeacherRescheduleReason = "lead_no_confirmo" | "profe_no_puede" | "lead_cancelo";

export const TEACHER_RESCHEDULE_REASONS: readonly TeacherRescheduleReason[] = ["lead_no_confirmo", "profe_no_puede", "lead_cancelo"];

/** Desde cuántos minutos antes de la clase se puede reagendar por falta de confirmación. */
export const NO_CONFIRM_WINDOW_MIN = 60;

export const NOTE_MIN_CHARS = 5;
export const NOTE_MAX_CHARS = 500;

export type NoConfirmBlock = "no_upcoming_trial" | "confirmed" | "no_voice_note" | "too_early";

export type NoConfirmEvaluation = {
  allowed: boolean;
  blockedBy: NoConfirmBlock | null;
  /** Momento desde el que se abre la opción (clase − NO_CONFIRM_WINDOW_MIN). Null si no hay clase futura. */
  availableFrom: string | null;
};

/**
 * ¿Puede el profe reagendar AHORA por falta de confirmación?
 * El orden de los bloqueos es el que más ayuda al profe: primero lo que
 * hace la opción imposible (confirmó), luego lo que depende de él (nota
 * de voz) y por último lo que solo requiere esperar.
 */
export function evaluateNoConfirm(input: {
  nowMs: number;
  scheduledAt: string | null;
  leadConfirmed: boolean;
  voiceNoteSent: boolean;
}): NoConfirmEvaluation {
  if (!input.scheduledAt) return { allowed: false, blockedBy: "no_upcoming_trial", availableFrom: null };
  const startMs = new Date(input.scheduledAt).getTime();
  const availableFrom = new Date(startMs - NO_CONFIRM_WINDOW_MIN * 60_000).toISOString();
  if (input.leadConfirmed) return { allowed: false, blockedBy: "confirmed", availableFrom };
  if (!input.voiceNoteSent) return { allowed: false, blockedBy: "no_voice_note", availableFrom };
  if (input.nowMs < startMs - NO_CONFIRM_WINDOW_MIN * 60_000) return { allowed: false, blockedBy: "too_early", availableFrom };
  return { allowed: true, blockedBy: null, availableFrom };
}

/** "1 hora", "2 horas", "45 minutos"… según NO_CONFIRM_WINDOW_MIN. */
function windowLabel(): string {
  if (NO_CONFIRM_WINDOW_MIN % 60 !== 0) return `${NO_CONFIRM_WINDOW_MIN} minutos`;
  const h = NO_CONFIRM_WINDOW_MIN / 60;
  return h === 1 ? "1 hora" : `${h} horas`;
}

/** Texto para el profe cuando la opción "Lead no confirmó" está bloqueada. */
export function noConfirmBlockMessage(block: NoConfirmBlock, availableFromLabel?: string | null): string {
  switch (block) {
    case "no_upcoming_trial": return "Este lead no tiene una clase de prueba futura agendada.";
    case "confirmed":         return "El lead ya confirmó su asistencia, así que la clase se da.";
    case "no_voice_note":     return "Primero envíale tu nota de voz al lead y márcala en la tarjeta de la clase.";
    case "too_early":         return `Disponible desde ${windowLabel()} antes de la clase${availableFromLabel ? ` (a partir de las ${availableFromLabel})` : ""}, para darle margen al lead a confirmar.`;
  }
}

/** Valida el motivo escrito de "No puedo dar la clase". Devuelve el texto limpio o un error legible. */
export function validateTeacherNote(raw: unknown): { ok: true; note: string } | { ok: false; error: string } {
  const note = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (note.length < NOTE_MIN_CHARS) return { ok: false, error: "Escribe el motivo por el que no puedes dar la clase." };
  if (note.length > NOTE_MAX_CHARS) return { ok: false, error: `El motivo es demasiado largo (máximo ${NOTE_MAX_CHARS} caracteres).` };
  return { ok: true, note };
}

/**
 * Mensaje al lead según el motivo (copys aprobados por Gelfis 2026-11-24).
 * `whenText` es la fecha de la clase que se libera, ya formateada
 * (p. ej. "miércoles 25 de noviembre, 19:00 (Berlín)").
 * El motivo escrito por el profe NO viaja al lead.
 */
export function buildTeacherRescheduleLeadMessage(input: {
  reason: TeacherRescheduleReason;
  leadFirstName: string;
  teacherFirstName: string | null;
  whenText: string;
  rescheduleUrl: string;
}): string {
  const hola = input.leadFirstName ? `Hola ${input.leadFirstName} 👋` : "Hola 👋";
  if (input.reason === "lead_no_confirmo") {
    const con = input.teacherFirstName ? ` con ${input.teacherFirstName}` : "";
    return [
      hola,
      ``,
      `Te escribimos para confirmar tu clase de prueba del ${input.whenText}${con} y no recibimos respuesta, así que liberamos ese horario.`,
      ``,
      `Si sigues queriendo tu clase, elige nueva fecha aquí:`,
      `👉 ${input.rescheduleUrl}`,
      ``,
      `Cuando te escribamos para confirmar, respóndenos con un "Sí" y tu lugar queda asegurado 🙌`,
    ].join("\n");
  }
  if (input.reason === "lead_cancelo") {
    return [
      hola,
      ``,
      `Gracias por avisarnos que no podrás venir a tu clase de prueba del ${input.whenText}. ¡No pasa nada! Ya liberamos ese horario.`,
      ``,
      `Cuando te venga bien, elige una nueva fecha aquí:`,
      `👉 ${input.rescheduleUrl}`,
      ``,
      `Tu clase gratuita te sigue esperando, avísame por favor cuando hayas agendado 🙌`,
    ].join("\n");
  }
  const quien = input.teacherFirstName ?? "tu profesor/a";
  return [
    hola,
    ``,
    `Te pedimos disculpas: ${quien} no podrá darte la clase de prueba del ${input.whenText} por un imprevisto.`,
    ``,
    `Elige aquí el horario que mejor te venga y te guardamos el lugar:`,
    `👉 ${input.rescheduleUrl}`,
    ``,
    `Gracias por tu comprensión. ¡Nos vemos muy pronto!`,
  ].join("\n");
}

/** Etiqueta corta para historial y notas. */
export function teacherRescheduleReasonLabel(reason: TeacherRescheduleReason): string {
  return reason === "lead_no_confirmo" ? "lead no confirmó"
       : reason === "lead_cancelo"     ? "el lead canceló"
       : "el profe no puede dar la clase";
}
