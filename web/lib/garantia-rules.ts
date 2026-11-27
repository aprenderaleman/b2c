/**
 * Reglas de la Garantía de Nivel (Gelfis 2026-11-27). Archivo PURO (sin BD)
 * para poder testearlo. El acceso a datos vive en lib/garantia-nivel.ts.
 *
 * Qué dice la garantía por escrito (lib/garantia-pdf.ts):
 *   • asistir al menos al 85 % de las clases programadas,
 *   • completar al menos el 85 % de los ejercicios de SCHULE,
 *   • tener esos ejercicios hechos, como máximo, el último día de clases.
 *   El cumplimiento se comprueba al terminar la última clase del programa.
 *
 * Hasta hoy la tarjeta decía "Activa" mirando solo la asistencia (con 80 %)
 * y dando SCHULE por bueno porque el dato nunca se conectó (Jonathan y
 * Veronica, 2026-11-27). Ahora:
 *   1. Umbrales iguales al contrato: 85 / 85.
 *   2. Lo que no se sabe no se da por bueno: sin dato de SCHULE el estado
 *      no puede ser "al día".
 *   3. Los ejercicios se miden contra el AVANCE del curso: a mitad de curso
 *      se espera más o menos la mitad del 85 % (con 10 puntos de margen).
 *   4. "No cumple" solo cuando ya no hay remedio: la asistencia no puede
 *      llegar al 85 % aunque asista a todo lo que queda, o el programa
 *      terminó sin cumplir.
 */

export type GarantiaStatus = "active" | "at_risk" | "lost" | "not_applicable";

export const ATTENDANCE_THRESHOLD = 85;
export const SCHULE_THRESHOLD = 85;
/** Margen (puntos) sobre el % de ejercicios esperado a día de hoy. */
export const SCHULE_SLACK = 10;
/** Con menos clases no hay base para valorar nada. */
export const MIN_CLASSES_TO_EVALUATE = 3;

/** "84,6" / "85": un decimal solo si hace falta, truncando hacia abajo para no aparentar que se llega al mínimo. */
export function formatGarantiaPct(n: number): string {
  return String(Math.floor(n * 10) / 10).replace(".", ",");
}

/** Reglas antiguas (solo asistencia, 80 %; SCHULE desconocido = bueno).
 *  Las sigue usando el panel del ALUMNO hasta que se active la tarjeta nueva. */
export function legacyGarantiaStatus(attendanceRate: number | null, schuleCompletion: number | null): GarantiaStatus {
  if (attendanceRate === null) return "not_applicable";
  const attendanceOk = attendanceRate >= 80;
  const schuleOk = schuleCompletion === null || schuleCompletion >= 70;
  if (attendanceOk && schuleOk) return "active";
  if (attendanceRate < 50) return "lost";
  return "at_risk";
}

const FLUIDEZ_LEVELS = ["A1", "A2", "B1"];

/**
 * Fracción (0–1) del NIVEL ACTUAL que el alumno ya ha recorrido en clases.
 * SCHULE mide el progreso del nivel en curso, así que el avance se compara
 * por nivel. Programas de un nivel: consumidas / totales. Fluidez Total
 * (A1→B1, 3 niveles): se reparte el total entre los 3 y se mira el tramo
 * del nivel actual. Sin total de clases no se puede calcular → null.
 */
export function levelProgressFraction(input: { goal: string | null; currentLevel: string | null; consumed: number; totalClasses: number | null }): number | null {
  const total = input.totalClasses ?? 0;
  if (total <= 0) return null;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  if (input.goal === "fluidez_total") {
    const perLevel = total / FLUIDEZ_LEVELS.length;
    const idx = Math.max(0, FLUIDEZ_LEVELS.indexOf((input.currentLevel ?? "A1").toUpperCase()));
    return clamp((input.consumed - idx * perLevel) / perLevel);
  }
  return clamp(input.consumed / total);
}

export type GarantiaEvaluation = {
  status: GarantiaStatus;
  /** % de asistencia (null si aún no hay clases suficientes). */
  attendanceRate: number | null;
  /** % de ejercicios de SCHULE (null = sin dato). */
  schulePct: number | null;
  /** % de ejercicios que debería llevar hoy según su avance (null si no se puede calcular). */
  expectedSchulePct: number | null;
  /** true si falta el dato de SCHULE: el estado no se puede dar por bueno. */
  schuleUnknown: boolean;
  /** El programa ya terminó: el resultado es definitivo. */
  programFinished: boolean;
  /** Motivos en lenguaje llano, para el profe. Vacío si va al día. */
  reasons: string[];
};

export function evaluateGarantia(input: {
  /** Clases regulares ya celebradas (dadas o ausencia). */
  held: number;
  /** De esas, a cuántas asistió. */
  attended: number;
  /** Clases del programa contratado (null si no consta). */
  totalClasses: number | null;
  /** % de ejercicios de SCHULE del nivel actual; null = sin dato. */
  schulePct: number | null;
  /** Fracción 0–1 del nivel actual recorrida (levelProgressFraction). */
  levelFraction: number | null;
}): GarantiaEvaluation {
  const { held, attended, totalClasses } = input;
  const schulePct = input.schulePct === null || input.schulePct === undefined ? null : Math.max(0, Math.min(100, Number(input.schulePct)));
  const base = { schulePct, schuleUnknown: schulePct === null, programFinished: false, reasons: [] as string[] };

  if (held < MIN_CLASSES_TO_EVALUATE) {
    return { ...base, status: "not_applicable", attendanceRate: null, expectedSchulePct: null };
  }

  const attendanceRate = Math.round((attended / held) * 100 * 100) / 100;
  const missed = held - attended;
  const total = totalClasses && totalClasses > 0 ? totalClasses : null;
  const programFinished = total !== null && held >= total;
  const expectedSchulePct = programFinished
    ? SCHULE_THRESHOLD
    : input.levelFraction === null ? null : Math.round(SCHULE_THRESHOLD * input.levelFraction);

  const reasons: string[] = [];
  // Un decimal como mucho: 84,62 % no puede leerse como "85 % (mínimo 85 %)".
  const pct = (n: number) => `${formatGarantiaPct(n)} %`;

  // ── Asistencia ──
  const attendanceOk = attendanceRate >= ATTENDANCE_THRESHOLD;
  // ¿Puede llegar todavía al 85 % si asiste a todas las que quedan?
  const attendanceUnreachable = total !== null && ((total - missed) / total) * 100 < ATTENDANCE_THRESHOLD;
  if (attendanceUnreachable) {
    reasons.push(`Asistencia: ha faltado a ${missed} de ${total} clases; ya no puede llegar al ${ATTENDANCE_THRESHOLD} %.`);
  } else if (!attendanceOk) {
    reasons.push(`Asistencia: ${pct(attendanceRate)} (mínimo ${ATTENDANCE_THRESHOLD} %).`);
  }

  // ── Ejercicios de SCHULE ──
  let schuleOk: boolean;
  if (schulePct === null) {
    schuleOk = false;
    reasons.push("Ejercicios de SCHULE: sin datos todavía.");
  } else if (programFinished) {
    schuleOk = schulePct >= SCHULE_THRESHOLD;
    if (!schuleOk) reasons.push(`Ejercicios de SCHULE: terminó con ${pct(schulePct)} (mínimo ${SCHULE_THRESHOLD} %).`);
  } else if (expectedSchulePct === null) {
    schuleOk = true;   // sin total de clases no hay ritmo con el que comparar
  } else {
    schuleOk = schulePct >= expectedSchulePct - SCHULE_SLACK;
    if (!schuleOk) reasons.push(`Ejercicios de SCHULE: lleva ${pct(schulePct)} y a estas alturas debería ir por el ${pct(expectedSchulePct)}.`);
  }

  let status: GarantiaStatus;
  if (attendanceUnreachable) status = "lost";
  else if (programFinished) status = attendanceOk && schuleOk ? "active" : "lost";
  else status = attendanceOk && schuleOk ? "active" : "at_risk";

  return { status, attendanceRate, schulePct, expectedSchulePct, schuleUnknown: schulePct === null, programFinished, reasons };
}
