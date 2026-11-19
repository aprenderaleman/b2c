import { describe, expect, it } from "vitest";
import {
  attributeLead, attributeMark, latestTrialPerLead, parsePeriod, pct, periodSince, studentState,
  summarizeLeadForTeacher, trialOutcome,
  type LeadAttribution, type LeadLite, type TrialClassLite,
} from "./teacher-metrics";

const cls = (over: Partial<TrialClassLite>): TrialClassLite => ({
  id: "c1", lead_id: "l1", status: "completed", scheduled_at: "2026-11-10T15:00:00Z", duration_minutes: 40, ...over,
});
const lead = (over: Partial<LeadLite>): LeadLite => ({
  id: "l1", trial_attended_at: null, trial_absent_at: null, converted_to_user_id: null, ...over,
});
const none: LeadAttribution = { attendedClassId: null, absentClassId: null, conversionClassId: null };
const NOW = new Date("2026-11-19T12:00:00Z").getTime();

describe("attributeMark", () => {
  const a = cls({ id: "a", scheduled_at: "2026-08-03T12:30:00Z", status: "cancelled" });
  const b = cls({ id: "b", scheduled_at: "2026-08-03T17:30:00Z" });
  const c = cls({ id: "c", scheduled_at: "2026-08-20T13:00:00Z" });

  it("marca al terminar la clase → esa clase", () => {
    expect(attributeMark("2026-08-03T18:15:00Z", [a, b])).toBe("b");
  });
  it("marca tardía (8 días después, sin más pruebas) → sigue siendo esa clase", () => {
    expect(attributeMark("2026-08-11T18:34:00Z", [a, b])).toBe("b");
  });
  it("con una prueba posterior, la marca va a la última ya empezada al marcar", () => {
    expect(attributeMark("2026-08-11T18:34:00Z", [a, b, c])).toBe("b");
    expect(attributeMark("2026-08-20T14:00:00Z", [a, b, c])).toBe("c");
  });
  it("nunca se atribuye a una clase cancelada", () => {
    expect(attributeMark("2026-08-03T13:30:00Z", [a])).toBeNull();
  });
  it("una marca anterior a todas las clases no se atribuye (dato de una prueba vieja)", () => {
    expect(attributeMark("2026-08-12T08:53:00Z", [cls({ id: "z", scheduled_at: "2026-11-19T12:30:00Z" })])).toBeNull();
  });
  it("marcada hasta 2 h antes de empezar la clase cuenta para esa clase", () => {
    expect(attributeMark("2026-08-20T11:30:00Z", [c])).toBe("c");
  });
  it("sin marca → null", () => {
    expect(attributeMark(null, [b])).toBeNull();
  });
});

describe("attributeLead", () => {
  const simon = cls({ id: "s", scheduled_at: "2026-08-03T16:00:00Z" });
  const jon = cls({ id: "j", scheduled_at: "2026-08-20T13:00:00Z" });

  it("no asistió con uno y asistió después con otro: cada marca a su clase", () => {
    const attr = attributeLead(lead({ trial_absent_at: "2026-08-03T16:30:00Z", trial_attended_at: "2026-08-20T13:50:00Z" }), [simon, jon]);
    expect(attr).toEqual({ attendedClassId: "j", absentClassId: "s", conversionClassId: null });
  });
  it("si las dos marcas caen en la misma clase, manda 'asistió'", () => {
    const attr = attributeLead(lead({ trial_absent_at: "2026-08-20T13:20:00Z", trial_attended_at: "2026-08-20T13:50:00Z" }), [jon]);
    expect(attr.attendedClassId).toBe("j");
    expect(attr.absentClassId).toBeNull();
  });
  it("la conversión es de la prueba a la que asistió", () => {
    const attr = attributeLead(lead({ trial_attended_at: "2026-08-03T16:50:00Z", converted_to_user_id: "u1" }), [simon, jon]);
    expect(attr.conversionClassId).toBe("s");
  });
  it("conversión sin marca de asistencia → su última prueba no cancelada", () => {
    const attr = attributeLead(lead({ converted_to_user_id: "u1" }), [simon, jon, cls({ id: "x", scheduled_at: "2026-09-01T10:00:00Z", status: "cancelled" })]);
    expect(attr.conversionClassId).toBe("j");
  });
  it("sin lead → sin atribución", () => {
    expect(attributeLead(undefined, [simon])).toEqual(none);
  });
});

describe("trialOutcome", () => {
  it("clase futura agendada → pendiente", () => {
    expect(trialOutcome(cls({ status: "scheduled", scheduled_at: "2026-11-25T15:00:00Z" }), none, NOW)).toBe("pending");
  });
  it("asistió / no asistió según la atribución", () => {
    expect(trialOutcome(cls({}), { ...none, attendedClassId: "c1" }, NOW)).toBe("attended");
    expect(trialOutcome(cls({}), { ...none, absentClassId: "c1" }, NOW)).toBe("absent");
  });
  it("clase con estado absent aunque el lead no tenga marca", () => {
    expect(trialOutcome(cls({ status: "absent" }), none, NOW)).toBe("absent");
  });
  it("clase pasada 'completed' sin marca → sin marcar (completed no implica asistencia)", () => {
    expect(trialOutcome(cls({}), none, NOW)).toBe("unmarked");
  });
  it("la marca de otra clase no cuenta para esta", () => {
    expect(trialOutcome(cls({}), { ...none, attendedClassId: "otra" }, NOW)).toBe("unmarked");
  });
});

describe("summarizeLeadForTeacher", () => {
  const first = cls({ id: "f", scheduled_at: "2026-08-19T13:00:00Z" });
  const second = cls({ id: "g", scheduled_at: "2026-08-26T13:00:00Z" });

  it("asistió a la primera y tiene otra posterior sin marca → cuenta como asistió", () => {
    const r = summarizeLeadForTeacher([first, second], { ...none, attendedClassId: "f" }, NOW);
    expect(r.outcome).toBe("attended");
    expect(r.cls.id).toBe("f");
  });
  it("no asistió a la primera y la segunda es futura → pendiente", () => {
    const fut = cls({ id: "h", scheduled_at: "2026-11-25T13:00:00Z", status: "scheduled" });
    expect(summarizeLeadForTeacher([first, fut], { ...none, absentClassId: "f" }, NOW).outcome).toBe("pending");
  });
  it("no asistió a la primera y la segunda quedó sin marcar → no asistió", () => {
    expect(summarizeLeadForTeacher([first, second], { ...none, absentClassId: "f" }, NOW).outcome).toBe("absent");
  });
  it("la conversión solo cuenta si es de una de SUS clases", () => {
    expect(summarizeLeadForTeacher([first], { ...none, attendedClassId: "f", conversionClassId: "f" }, NOW).converted).toBe(true);
    expect(summarizeLeadForTeacher([first], { ...none, absentClassId: "f", conversionClassId: "de-otro-profe" }, NOW).converted).toBe(false);
  });
});

describe("latestTrialPerLead", () => {
  it("un lead que reagenda cuenta una vez, con su última clase no cancelada", () => {
    const m = latestTrialPerLead([
      cls({ id: "a", scheduled_at: "2026-11-01T10:00:00Z" }),
      cls({ id: "b", scheduled_at: "2026-11-08T10:00:00Z" }),
      cls({ id: "c", scheduled_at: "2026-11-09T10:00:00Z", status: "cancelled" }),
    ]);
    expect(m.size).toBe(1);
    expect(m.get("l1")?.id).toBe("b");
  });
  it("leads solo con clases canceladas no entran", () => {
    expect(latestTrialPerLead([cls({ status: "cancelled" })]).size).toBe(0);
  });
  it("clases sin lead se ignoran", () => {
    expect(latestTrialPerLead([cls({ lead_id: null })]).size).toBe(0);
  });
});

describe("studentState", () => {
  const base = { userActive: true, subscriptionStatus: "active", hasActiveGroupWithTeacher: true, hasActiveGroupWithOther: false };
  const gone = { userActive: false, hasActiveGroupWithTeacher: false, hasActiveGroupWithOther: false };
  it("activo con el profe", () => { expect(studentState(base)).toBe("active"); });
  it("en pausa con el profe", () => { expect(studentState({ ...base, subscriptionStatus: "paused" })).toBe("paused"); });
  it("pasó a otro profe y sigue en la academia → reasignado, no baja", () => {
    expect(studentState({ ...base, hasActiveGroupWithTeacher: false, hasActiveGroupWithOther: true })).toBe("reassigned");
  });
  it("completó su plan → terminado", () => {
    expect(studentState({ ...gone, subscriptionStatus: "expired" })).toBe("finished");
  });
  it("canceló → baja", () => {
    expect(studentState({ ...gone, subscriptionStatus: "cancelled" })).toBe("churned");
  });
  it("canceló, pero su última clase fue con otro profe → no es baja de este", () => {
    expect(studentState({ ...gone, subscriptionStatus: "cancelled", lastTaughtByOther: true })).toBe("reassigned");
    expect(studentState({ ...gone, subscriptionStatus: "expired", lastTaughtByOther: true })).toBe("reassigned");
  });
  it("activo con el profe aunque su última clase fuese una sustitución de otro", () => {
    expect(studentState({ ...base, lastTaughtByOther: true })).toBe("active");
  });
  it("usuario desactivado con estado activo y grupo aún abierto → baja", () => {
    expect(studentState({ ...base, userActive: false })).toBe("churned");
  });
});

describe("pct / periodos", () => {
  it("pct sin denominador → null", () => {
    expect(pct(3, 0)).toBeNull();
    expect(pct(1, 4)).toBe(25);
  });
  it("parsePeriod acepta solo los periodos conocidos", () => {
    expect(parsePeriod("90")).toBe("90");
    expect(parsePeriod(["mes"])).toBe("mes");
    expect(parsePeriod("x")).toBe("todo");
    expect(parsePeriod(undefined)).toBe("todo");
  });
  it("periodSince: 'mes' es el día 1 a medianoche de Berlín", () => {
    expect(periodSince("mes", new Date("2026-11-19T12:00:00Z"))?.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(periodSince("mes", new Date("2026-07-10T12:00:00Z"))?.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(periodSince("todo")).toBeNull();
  });
});
