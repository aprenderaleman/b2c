import { describe, expect, it } from "vitest";
import {
  latestTrialPerLead, markBelongsToClass, parsePeriod, pct, periodSince, studentState, trialOutcome,
  type LeadLite, type TrialClassLite,
} from "./teacher-metrics";

const cls = (over: Partial<TrialClassLite>): TrialClassLite => ({
  id: "c1", lead_id: "l1", status: "completed", scheduled_at: "2026-11-10T15:00:00Z", duration_minutes: 40, ...over,
});
const lead = (over: Partial<LeadLite>): LeadLite => ({
  id: "l1", trial_attended_at: null, trial_absent_at: null, converted_to_user_id: null, ...over,
});
const NOW = new Date("2026-11-19T12:00:00Z").getTime();

describe("markBelongsToClass", () => {
  it("la marca justo al terminar la clase pertenece a esa clase", () => {
    expect(markBelongsToClass("2026-11-10T15:45:00Z", "2026-11-10T15:00:00Z")).toBe(true);
  });
  it("marcada al día siguiente también", () => {
    expect(markBelongsToClass("2026-11-11T09:00:00Z", "2026-11-10T15:00:00Z")).toBe(true);
  });
  it("una marca de otra prueba (días antes o después) no", () => {
    expect(markBelongsToClass("2026-11-03T15:45:00Z", "2026-11-10T15:00:00Z")).toBe(false);
    expect(markBelongsToClass("2026-11-14T15:45:00Z", "2026-11-10T15:00:00Z")).toBe(false);
  });
  it("sin marca → false", () => {
    expect(markBelongsToClass(null, "2026-11-10T15:00:00Z")).toBe(false);
  });
});

describe("trialOutcome", () => {
  it("clase futura agendada → pendiente", () => {
    expect(trialOutcome(cls({ status: "scheduled", scheduled_at: "2026-11-25T15:00:00Z" }), lead({}), NOW)).toBe("pending");
  });
  it("lead marcado como asistió en esa clase", () => {
    expect(trialOutcome(cls({}), lead({ trial_attended_at: "2026-11-10T15:50:00Z" }), NOW)).toBe("attended");
  });
  it("lead marcado como no asistió en esa clase", () => {
    expect(trialOutcome(cls({}), lead({ trial_absent_at: "2026-11-10T15:20:00Z" }), NOW)).toBe("absent");
  });
  it("clase con estado absent aunque el lead no tenga marca", () => {
    expect(trialOutcome(cls({ status: "absent" }), lead({}), NOW)).toBe("absent");
  });
  it("clase pasada 'completed' sin marca en el lead → sin marcar (completed no implica asistencia)", () => {
    expect(trialOutcome(cls({}), lead({}), NOW)).toBe("unmarked");
  });
  it("la asistencia a una prueba posterior con otro profe no cuenta para esta clase", () => {
    expect(trialOutcome(cls({}), lead({ trial_attended_at: "2026-11-17T15:50:00Z" }), NOW)).toBe("unmarked");
  });
  it("sin lead cargado → sin marcar", () => {
    expect(trialOutcome(cls({}), undefined, NOW)).toBe("unmarked");
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
  it("activo con el profe", () => { expect(studentState(base)).toBe("active"); });
  it("en pausa con el profe", () => { expect(studentState({ ...base, subscriptionStatus: "paused" })).toBe("paused"); });
  it("pasó a otro profe y sigue en la academia → reasignado, no baja", () => {
    expect(studentState({ ...base, hasActiveGroupWithTeacher: false, hasActiveGroupWithOther: true })).toBe("reassigned");
  });
  it("completó su plan → terminado", () => {
    expect(studentState({ userActive: false, subscriptionStatus: "expired", hasActiveGroupWithTeacher: false, hasActiveGroupWithOther: false })).toBe("finished");
  });
  it("canceló → baja", () => {
    expect(studentState({ userActive: false, subscriptionStatus: "cancelled", hasActiveGroupWithTeacher: false, hasActiveGroupWithOther: false })).toBe("churned");
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
