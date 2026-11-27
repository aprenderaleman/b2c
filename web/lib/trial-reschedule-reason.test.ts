import { describe, expect, it } from "vitest";
import {
  buildTeacherRescheduleLeadMessage, evaluateNoConfirm, noConfirmBlockMessage, validateTeacherNote,
  NO_CONFIRM_WINDOW_MIN,
} from "./trial-reschedule-reason";

const CLASS = "2026-11-25T18:00:00Z";
const at = (iso: string) => new Date(iso).getTime();
const base = { scheduledAt: CLASS, leadConfirmed: false, voiceNoteSent: true };

describe("evaluateNoConfirm", () => {
  it("sin confirmar + nota de voz + dentro de la última hora → permitido", () => {
    expect(evaluateNoConfirm({ ...base, nowMs: at("2026-11-25T17:30:00Z") })).toEqual({
      allowed: true, blockedBy: null, availableFrom: "2026-11-25T17:00:00.000Z",
    });
  });
  it("justo a 1 h exacta ya se puede", () => {
    expect(evaluateNoConfirm({ ...base, nowMs: at("2026-11-25T17:00:00Z") }).allowed).toBe(true);
  });
  it("un minuto antes de la ventana → demasiado pronto", () => {
    const r = evaluateNoConfirm({ ...base, nowMs: at("2026-11-25T16:59:00Z") });
    expect(r).toMatchObject({ allowed: false, blockedBy: "too_early" });
    expect(r.availableFrom).toBe("2026-11-25T17:00:00.000Z");
  });
  it("a 2 h de la clase (regla del primer día) ya NO se puede", () => {
    expect(evaluateNoConfirm({ ...base, nowMs: at("2026-11-25T16:00:00Z") }).blockedBy).toBe("too_early");
  });
  it("el día anterior → demasiado pronto", () => {
    expect(evaluateNoConfirm({ ...base, nowMs: at("2026-11-24T18:00:00Z") }).blockedBy).toBe("too_early");
  });
  it("lead confirmó → bloqueado aunque haya nota de voz y falte poco", () => {
    expect(evaluateNoConfirm({ ...base, leadConfirmed: true, nowMs: at("2026-11-25T17:30:00Z") }).blockedBy).toBe("confirmed");
  });
  it("sin nota de voz → bloqueado aunque falte poco", () => {
    expect(evaluateNoConfirm({ ...base, voiceNoteSent: false, nowMs: at("2026-11-25T17:30:00Z") }).blockedBy).toBe("no_voice_note");
  });
  it("confirmó y sin nota de voz → manda 'confirmó' (la clase se da)", () => {
    expect(evaluateNoConfirm({ ...base, leadConfirmed: true, voiceNoteSent: false, nowMs: at("2026-11-25T17:30:00Z") }).blockedBy).toBe("confirmed");
  });
  it("sin clase futura → bloqueado", () => {
    expect(evaluateNoConfirm({ ...base, scheduledAt: null, nowMs: at("2026-11-25T17:30:00Z") })).toEqual({
      allowed: false, blockedBy: "no_upcoming_trial", availableFrom: null,
    });
  });
  it("la ventana es de 60 minutos", () => { expect(NO_CONFIRM_WINDOW_MIN).toBe(60); });
});

describe("noConfirmBlockMessage", () => {
  it("demasiado pronto incluye la hora de apertura si se le pasa", () => {
    expect(noConfirmBlockMessage("too_early", "17:00")).toContain("a partir de las 17:00");
    expect(noConfirmBlockMessage("too_early", "17:00")).toContain("desde 1 hora antes de la clase");
    expect(noConfirmBlockMessage("too_early")).not.toContain("a partir de");
  });
  it("cada bloqueo tiene su explicación", () => {
    expect(noConfirmBlockMessage("confirmed")).toContain("ya confirmó");
    expect(noConfirmBlockMessage("no_voice_note")).toContain("nota de voz");
    expect(noConfirmBlockMessage("no_upcoming_trial")).toContain("clase de prueba futura");
  });
});

describe("validateTeacherNote", () => {
  it("vacío o muy corto → error", () => {
    expect(validateTeacherNote("").ok).toBe(false);
    expect(validateTeacherNote("   ").ok).toBe(false);
    expect(validateTeacherNote("no").ok).toBe(false);
    expect(validateTeacherNote(undefined).ok).toBe(false);
    expect(validateTeacherNote(42).ok).toBe(false);
  });
  it("limpia espacios y saltos de línea", () => {
    expect(validateTeacherNote("  Tengo   cita\nmédica  ")).toEqual({ ok: true, note: "Tengo cita médica" });
  });
  it("más de 500 caracteres → error", () => {
    expect(validateTeacherNote("a".repeat(501)).ok).toBe(false);
    expect(validateTeacherNote("a".repeat(500)).ok).toBe(true);
  });
});

describe("buildTeacherRescheduleLeadMessage", () => {
  const common = { leadFirstName: "Ana", teacherFirstName: "Sabine", whenText: "miércoles 25 de noviembre, 19:00 (Berlín)", rescheduleUrl: "https://b2c.aprender-aleman.de/agendar/cuando?lead=x" };

  it("lead no confirmó: explica el motivo, lleva el enlace y pide el 'Sí'", () => {
    const t = buildTeacherRescheduleLeadMessage({ ...common, reason: "lead_no_confirmo" });
    expect(t).toContain("Hola Ana 👋");
    expect(t).toContain("clase de prueba del miércoles 25 de noviembre, 19:00 (Berlín) con Sabine");
    expect(t).toContain("no recibimos respuesta, así que liberamos ese horario");
    expect(t).toContain("👉 https://b2c.aprender-aleman.de/agendar/cuando?lead=x");
    expect(t).toContain('respóndenos con un "Sí"');
  });
  it("profe no puede: disculpa, 'imprevisto' y enlace; nunca el motivo del profe", () => {
    const t = buildTeacherRescheduleLeadMessage({ ...common, reason: "profe_no_puede" });
    expect(t).toContain("Te pedimos disculpas: Sabine no podrá darte la clase de prueba del miércoles 25 de noviembre, 19:00 (Berlín) por un imprevisto.");
    expect(t).toContain("👉 https://b2c.aprender-aleman.de/agendar/cuando?lead=x");
    expect(t).not.toContain("no recibimos respuesta");
  });
  it("lead canceló: agradece el aviso, libera el horario y pide avisar al agendar", () => {
    const t = buildTeacherRescheduleLeadMessage({ ...common, reason: "lead_cancelo" });
    expect(t).toContain("Hola Ana 👋");
    expect(t).toContain("Gracias por avisarnos que no podrás venir a tu clase de prueba del miércoles 25 de noviembre, 19:00 (Berlín). ¡No pasa nada! Ya liberamos ese horario.");
    expect(t).toContain("👉 https://b2c.aprender-aleman.de/agendar/cuando?lead=x");
    expect(t).toContain("avísame por favor cuando hayas agendado 🙌");
    expect(t).not.toContain("no recibimos respuesta");
    expect(t).not.toContain("disculpas");
  });
  it("sin nombre de profe ni de lead sigue siendo legible", () => {
    const a = buildTeacherRescheduleLeadMessage({ ...common, leadFirstName: "", teacherFirstName: null, reason: "lead_no_confirmo" });
    expect(a.startsWith("Hola 👋")).toBe(true);
    expect(a).toContain("19:00 (Berlín) y no recibimos respuesta");
    const b = buildTeacherRescheduleLeadMessage({ ...common, teacherFirstName: null, reason: "profe_no_puede" });
    expect(b).toContain("tu profesor/a no podrá darte");
  });
});

describe("renderTeacherRescheduleEmail", () => {
  const common = { leadName: "Ana", teacherFirstName: "Sabine", whenText: "miércoles 25 de noviembre, 19:00 (Berlín)", rescheduleUrl: "https://b2c.aprender-aleman.de/agendar/cuando?lead=x" };
  it("cada motivo tiene su asunto y su texto, con el enlace", async () => {
    const { renderTeacherRescheduleEmail } = await import("./email/templates/trial-teacher-reschedule");
    const a = renderTeacherRescheduleEmail({ ...common, reason: "lead_no_confirmo" });
    const b = renderTeacherRescheduleEmail({ ...common, reason: "profe_no_puede" });
    const c = renderTeacherRescheduleEmail({ ...common, reason: "lead_cancelo" });
    expect(new Set([a.subject, b.subject, c.subject]).size).toBe(3);
    expect(a.text).toContain("no recibimos respuesta");
    expect(b.text).toContain("Sabine no podrá darte la clase");
    expect(c.text).toContain("Gracias por avisarnos que no podrás venir");
    for (const m of [a, b, c]) {
      expect(m.text).toContain("👉 https://b2c.aprender-aleman.de/agendar/cuando?lead=x");
      expect(m.html).toContain("https://b2c.aprender-aleman.de/agendar/cuando?lead=x");
    }
  });
});
