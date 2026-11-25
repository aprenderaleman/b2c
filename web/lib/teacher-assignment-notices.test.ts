import { describe, expect, it } from "vitest";
import {
  fixWelcomeTeacherName, isAssignmentNoticeToStudent, renderAssignmentNotices,
  type AssignmentNoticeInput,
} from "./teacher-assignment-notices";

const base: AssignmentNoticeInput = {
  student: { fullName: "Angela Aebischer", level: "A1", goalLabel: "A2", planLabel: "Intensivo (12 clases al mes)", neverLoggedIn: true, phone: "+41 78 000 00 00", lang: "es" },
  newTeacher: { fullName: "Jonathan Weber" },
  oldTeacher: { fullName: "Sabine Arning", hasCommission: false },
  trialTeacher: { fullName: "Veronica Fusco", hasCommission: true },
  note: "Pidió clases por la mañana a las 7:00",
  includePhone: true,
};

describe("renderAssignmentNotices — profe nuevo", () => {
  it("datos de la ficha, nota del admin y contacto con WhatsApp si no ha entrado nunca", () => {
    const t = renderAssignmentNotices(base).toNewTeacher;
    expect(t).toContain(`Hola Jonathan! Te asigné a Angela Aebischer: ya aparece en "Mis estudiantes" y en tus chats.`);
    expect(t).toContain("• Nivel A1, plan Intensivo (12 clases al mes), meta A2.");
    expect(t).toContain("• Pidió clases por la mañana a las 7:00");
    expect(t).toContain("Todavía no ha entrado a la plataforma, así que si no te contesta escríbele por WhatsApp: +41 78 000 00 00.");
    expect(t.endsWith("— Gelfis")).toBe(true);
  });
  it("sin incluir el WhatsApp no aparece el número", () => {
    const t = renderAssignmentNotices({ ...base, includePhone: false }).toNewTeacher;
    expect(t).not.toContain("+41");
    expect(t).toContain("Todavía no ha entrado a la plataforma.");
  });
  it("si el alumno ya entró, no dice que no ha entrado", () => {
    const t = renderAssignmentNotices({ ...base, student: { ...base.student, neverLoggedIn: false } }).toNewTeacher;
    expect(t).not.toContain("Todavía no ha entrado");
    expect(t).toContain("Si no te contesta, escríbele por WhatsApp: +41 78 000 00 00.");
  });
  it("sin nota ni datos no inventa viñetas", () => {
    const t = renderAssignmentNotices({ ...base, note: "  ", student: { ...base.student, level: null, goalLabel: null, planLabel: null } }).toNewTeacher;
    expect(t).not.toContain("•");
  });
});

describe("renderAssignmentNotices — profe anterior y profe de la prueba", () => {
  it("la comisión solo se menciona a quien la tiene registrada", () => {
    const n = renderAssignmentNotices(base);
    expect(n.toOldTeacher).toBe("Hola Sabine! Te aviso: Angela Aebischer pasa con Jonathan Weber.\n\n— Gelfis");
    expect(n.toTrialTeacher).toBe("Hola Veronica! Te aviso: Angela Aebischer, a quien diste la clase de prueba, queda con Jonathan Weber. Tu comisión por su inscripción se mantiene igual.\n\n— Gelfis");
  });
  it("primera asignación: no hay profe anterior al que avisar", () => {
    const n = renderAssignmentNotices({ ...base, oldTeacher: null, trialTeacher: null });
    expect(n.toOldTeacher).toBeNull();
    expect(n.toTrialTeacher).toBeNull();
  });
  it("profe anterior con comisión (dio la prueba y era su profe)", () => {
    const n = renderAssignmentNotices({ ...base, oldTeacher: { fullName: "Jonathan Weber", hasCommission: true }, newTeacher: { fullName: "Simon Heimler Castro" }, trialTeacher: null });
    expect(n.toOldTeacher).toContain("pasa con Simon Heimler Castro. Tu comisión por su inscripción se mantiene igual.");
  });
});

describe("renderAssignmentNotices — alumno", () => {
  it("cambio de profe para un alumno que ya usa la plataforma, firmado por Stiv", () => {
    expect(renderAssignmentNotices({ ...base, student: { ...base.student, neverLoggedIn: false } }).toStudent).toBe(
      "¡Hola Angela! Un cambio en tus clases: tu profesor/a será Jonathan Weber, que te escribirá por aquí para fijar tus horarios.\n\nCualquier duda, me escribes por aquí.\n\n— Stiv");
  });
  it("si nunca entró a la plataforma no se le habla de 'cambio': se le presenta al profe", () => {
    const t = renderAssignmentNotices(base).toStudent;
    expect(t).toContain("¡Hola Angela! Ya tienes profesor/a: Jonathan Weber, que te escribirá por aquí");
    expect(t).not.toContain("Un cambio");
  });
  it("primera asignación", () => {
    expect(renderAssignmentNotices({ ...base, oldTeacher: null }).toStudent).toContain("¡Hola Angela! Ya tienes profesor/a: Jonathan Weber, que te escribirá por aquí");
  });
  it("alumno con idioma alemán", () => {
    const t = renderAssignmentNotices({ ...base, student: { ...base.student, lang: "de", neverLoggedIn: false } }).toStudent;
    expect(t).toContain("Hallo Angela! Eine Änderung bei deinem Unterricht: Dein Lehrer/deine Lehrerin ist ab jetzt Jonathan Weber");
    expect(t.endsWith("— Stiv")).toBe(true);
  });
  it("el motivo del cambio y la nota del profe no van al alumno", () => {
    expect(renderAssignmentNotices(base).toStudent).not.toContain("7:00");
  });
});

describe("isAssignmentNoticeToStudent", () => {
  it("reconoce los avisos generados y los manuales de noviembre", () => {
    expect(isAssignmentNoticeToStudent(renderAssignmentNotices(base).toStudent)).toBe(true);
    expect(isAssignmentNoticeToStudent(renderAssignmentNotices({ ...base, student: { ...base.student, neverLoggedIn: false } }).toStudent)).toBe(true);
    expect(isAssignmentNoticeToStudent(renderAssignmentNotices({ ...base, student: { ...base.student, neverLoggedIn: false, lang: "de" } }).toStudent)).toBe(true);
    expect(isAssignmentNoticeToStudent(renderAssignmentNotices({ ...base, oldTeacher: null }).toStudent)).toBe(true);
    expect(isAssignmentNoticeToStudent(renderAssignmentNotices({ ...base, student: { ...base.student, lang: "de" } }).toStudent)).toBe(true);
    expect(isAssignmentNoticeToStudent(renderAssignmentNotices({ ...base, oldTeacher: null, student: { ...base.student, lang: "de" } }).toStudent)).toBe(true);
    expect(isAssignmentNoticeToStudent("¡Hola Angela! Una novedad sobre tu profesora: Veronica no tiene disponibilidad ahora mismo, así que tus clases serán con Sabine Arning.")).toBe(true);
    expect(isAssignmentNoticeToStudent("¡Hola Angela! Buenas noticias: ya tienes profesor con disponibilidad a las 7:00 de la mañana.")).toBe(true);
  });
  it("no confunde la bienvenida ni otros mensajes", () => {
    expect(isAssignmentNoticeToStudent("¡Hola Angela! Soy Stiv… Tu profesor/a es Veronica Fusco, que te escribirá por aquí para fijar tus horarios.")).toBe(false);
    expect(isAssignmentNoticeToStudent("Hola! Tu cuota de noviembre está pendiente.")).toBe(false);
    expect(isAssignmentNoticeToStudent("Hallo Anna! Ich bin Stiv… Dein Lehrer/deine Lehrerin ist Sina Hernandez und schreibt dir hier, um eure Termine festzulegen.")).toBe(false);
  });
});

describe("fixWelcomeTeacherName", () => {
  const welcome = "¡Hola Angela! Soy Stiv…\n\nTu plan: Intensivo (12 clases al mes), de A1 a A2. Tu profesor/a es Veronica Fusco, que te escribirá por aquí para fijar tus horarios.\n\n🎁 Bono…";
  it("cambia solo el nombre del profe", () => {
    const out = fixWelcomeTeacherName(welcome, "Jonathan Weber")!;
    expect(out).toContain("Tu profesor/a es Jonathan Weber, que te escribirá por aquí");
    expect(out.replace("Jonathan Weber", "Veronica Fusco")).toBe(welcome);
  });
  it("si ya dice el profe correcto o no es una bienvenida → null", () => {
    expect(fixWelcomeTeacherName(welcome, "Veronica Fusco")).toBeNull();
    expect(fixWelcomeTeacherName("Te estamos asignando profesor/a; te escribirá por aquí en breve.", "Jonathan Weber")).toBeNull();
  });
  it("versión alemana", () => {
    const de = "Dein Plan: Viajero. Dein Lehrer/deine Lehrerin ist Sina Hernandez und schreibt dir hier, um eure Termine festzulegen.";
    expect(fixWelcomeTeacherName(de, "Simon Heimler")).toContain("Dein Lehrer/deine Lehrerin ist Simon Heimler und schreibt dir hier");
  });
});
