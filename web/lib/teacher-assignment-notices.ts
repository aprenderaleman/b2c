/**
 * Mensajes de chat del botón "Asignar profe" de la ficha del estudiante
 * (Gelfis 2026-11-25). Al asignar o cambiar de profe se avisa a los
 * involucrados: el alumno (como Stiv), el profe nuevo, el profe anterior y
 * el profe que dio la clase de prueba.
 *
 * Reglas del copy (pedidas por Gelfis): breve y sin inventar. Solo datos de
 * la ficha; la línea de la comisión solo aparece si ese profe tiene de
 * verdad una comisión registrada por este alumno; la nota para el profe es
 * exactamente lo que escriba el admin.
 *
 * Archivo puro (sin BD) para poder testearlo.
 */

export type AssignmentNoticeInput = {
  student: {
    fullName: string;
    level: string | null;
    /** Meta ya en texto ("A2", "B1"…) o null si no hay. */
    goalLabel: string | null;
    /** Plan ya en texto ("Intensivo (12 clases al mes)") o null. */
    planLabel: string | null;
    /** Nunca ha entrado a la plataforma: no ha leído nada de su profe anterior,
     *  así que al alumno se le presenta al profe sin hablar de "cambio". */
    neverLoggedIn: boolean;
    phone: string | null;
    lang: "es" | "de";
  };
  newTeacher: { fullName: string };
  /** Profe del grupo individual antes del cambio; null si es la primera asignación. */
  oldTeacher: { fullName: string; hasCommission: boolean } | null;
  /** Profe de la clase de prueba, solo si NO es ni el nuevo ni el anterior. */
  trialTeacher: { fullName: string; hasCommission: boolean } | null;
  /** Nota libre del admin para el profe nuevo (horarios, contexto). */
  note: string | null;
  includePhone: boolean;
};

export type AssignmentNotices = {
  toStudent: string;
  toNewTeacher: string;
  toOldTeacher: string | null;
  toTrialTeacher: string | null;
};

const first = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

const COMMISSION_LINE = "Tu comisión por su inscripción se mantiene igual.";

export function renderAssignmentNotices(i: AssignmentNoticeInput): AssignmentNotices {
  const alumno = i.student.fullName.trim();
  const nuevo = i.newTeacher.fullName.trim();

  // ── Profe nuevo ─────────────────────────────────────────────────────────
  const datos = [
    i.student.level ? `nivel ${i.student.level}` : null,
    i.student.planLabel ? `plan ${i.student.planLabel}` : null,
    i.student.goalLabel ? `meta ${i.student.goalLabel}` : null,
  ].filter(Boolean).join(", ");
  const note = (i.note ?? "").replace(/\s+/g, " ").trim();
  const phone = i.includePhone ? (i.student.phone ?? "").trim() : "";
  const contacto = i.student.neverLoggedIn
    ? `Escríbele por el chat para fijar horarios. Todavía no ha entrado a la plataforma${phone ? `, así que si no te contesta escríbele por WhatsApp: ${phone}` : ""}.`
    : `Escríbele por el chat para fijar horarios.${phone ? ` Si no te contesta, escríbele por WhatsApp: ${phone}.` : ""}`;
  const toNewTeacher = [
    `Hola ${first(nuevo)}! Te asigné a ${alumno}: ya aparece en "Mis estudiantes" y en tus chats.`,
    [datos ? `• ${datos.charAt(0).toUpperCase()}${datos.slice(1)}.` : null, note ? `• ${note}` : null].filter(Boolean).join("\n") || null,
    contacto,
    `— Gelfis`,
  ].filter(Boolean).join("\n\n");

  // ── Profe anterior / profe de la prueba ─────────────────────────────────
  const toOldTeacher = i.oldTeacher
    ? [
        `Hola ${first(i.oldTeacher.fullName)}! Te aviso: ${alumno} pasa con ${nuevo}.${i.oldTeacher.hasCommission ? ` ${COMMISSION_LINE}` : ""}`,
        `— Gelfis`,
      ].join("\n\n")
    : null;
  const toTrialTeacher = i.trialTeacher
    ? [
        `Hola ${first(i.trialTeacher.fullName)}! Te aviso: ${alumno}, a quien diste la clase de prueba, queda con ${nuevo}.${i.trialTeacher.hasCommission ? ` ${COMMISSION_LINE}` : ""}`,
        `— Gelfis`,
      ].join("\n\n")
    : null;

  // ── Alumno (lo firma Stiv) ──────────────────────────────────────────────
  const isChange = !!i.oldTeacher && !i.student.neverLoggedIn;
  const toStudent = i.student.lang === "de"
    ? [
        isChange
          ? `Hallo ${first(alumno)}! Eine Änderung bei deinem Unterricht: Dein Lehrer/deine Lehrerin ist ab jetzt ${nuevo} und schreibt dir hier, um eure Termine festzulegen.`
          : `Hallo ${first(alumno)}! Du hast jetzt einen Lehrer/eine Lehrerin: ${nuevo} schreibt dir hier, um eure Termine festzulegen.`,
        `Bei Fragen schreib mir einfach hier.`,
        `— Stiv`,
      ].join("\n\n")
    : [
        isChange
          ? `¡Hola ${first(alumno)}! Un cambio en tus clases: tu profesor/a será ${nuevo}, que te escribirá por aquí para fijar tus horarios.`
          : `¡Hola ${first(alumno)}! Ya tienes profesor/a: ${nuevo}, que te escribirá por aquí para fijar tus horarios.`,
        `Cualquier duda, me escribes por aquí.`,
        `— Stiv`,
      ].join("\n\n");

  return { toStudent, toNewTeacher, toOldTeacher, toTrialTeacher };
}

/**
 * ¿Es este mensaje (de la academia al alumno) un aviso de asignación de
 * profe? Sirve para retirar los avisos anteriores que el alumno aún no ha
 * leído cuando se le vuelve a cambiar de profe: así solo ve el dato vigente.
 * Reconoce los textos de este archivo y los avisos manuales de nov-2026.
 */
export function isAssignmentNoticeToStudent(content: string): boolean {
  return /tu profesor\/a será |Ya tienes profesor\/a: |tus clases serán con |ya tienes profesor con disponibilidad|Eine Änderung bei deinem Unterricht|Du hast jetzt einen Lehrer\/eine Lehrerin/i.test(content);
}

/**
 * Corrige el nombre del profe en la bienvenida de Stiv ("Tu profesor/a es X,"
 * / "Dein Lehrer/deine Lehrerin ist X und") si el alumno aún no la ha leído.
 * Devuelve el texto nuevo, o null si no hay nada que cambiar.
 */
export function fixWelcomeTeacherName(content: string, newTeacherFullName: string): string | null {
  const es = /(Tu profesor\/a es )([^,\n]+)(, que te escribirá por aquí)/;
  const de = /(Dein Lehrer\/deine Lehrerin ist )([^\n]+?)( und schreibt dir hier)/;
  for (const re of [es, de]) {
    const m = content.match(re);
    if (m) return m[2] === newTeacherFullName ? null : content.replace(re, `$1${newTeacherFullName}$3`);
  }
  return null;
}
