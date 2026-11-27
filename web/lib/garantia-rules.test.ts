import { describe, expect, it } from "vitest";
import { evaluateGarantia, formatGarantiaPct, legacyGarantiaStatus, levelProgressFraction } from "./garantia-rules";

const ev = (over: Partial<Parameters<typeof evaluateGarantia>[0]>) =>
  evaluateGarantia({ held: 16, attended: 16, totalClasses: 32, schulePct: 45, levelFraction: 0.5, ...over });

describe("levelProgressFraction", () => {
  it("programa de un nivel: consumidas / totales", () => {
    expect(levelProgressFraction({ goal: "a1_a2", currentLevel: "A1", consumed: 16, totalClasses: 32 })).toBe(0.5);
    expect(levelProgressFraction({ goal: "c1", currentLevel: "B2", consumed: 12, totalClasses: 48 })).toBe(0.25);
  });
  it("nunca pasa de 1 ni baja de 0", () => {
    expect(levelProgressFraction({ goal: "b1", currentLevel: "A2", consumed: 40, totalClasses: 32 })).toBe(1);
    expect(levelProgressFraction({ goal: "b1", currentLevel: "A2", consumed: 0, totalClasses: 32 })).toBe(0);
  });
  it("Fluidez Total (3 niveles): mira el tramo del nivel actual", () => {
    // 92 clases → ~30,67 por nivel. En A2 con 46 clases lleva la mitad de A2.
    expect(levelProgressFraction({ goal: "fluidez_total", currentLevel: "A2", consumed: 46, totalClasses: 92 })).toBeCloseTo(0.5, 2);
    // Recién pasado a A2 (31 clases): casi al inicio del nivel, no al 34 % del programa.
    expect(levelProgressFraction({ goal: "fluidez_total", currentLevel: "A2", consumed: 31, totalClasses: 92 })).toBeLessThan(0.02);
    expect(levelProgressFraction({ goal: "fluidez_total", currentLevel: "A1", consumed: 15, totalClasses: 92 })).toBeCloseTo(0.489, 2);
  });
  it("sin total de clases → null", () => {
    expect(levelProgressFraction({ goal: "a1_a2", currentLevel: "A1", consumed: 5, totalClasses: null })).toBeNull();
  });
});

describe("evaluateGarantia", () => {
  it("menos de 3 clases → no aplica todavía", () => {
    expect(ev({ held: 2, attended: 2 }).status).toBe("not_applicable");
  });

  it("asistencia perfecta y ejercicios al ritmo del curso → al día", () => {
    const r = ev({});
    expect(r.status).toBe("active");
    expect(r.expectedSchulePct).toBe(43);        // 85 % × 0,5
    expect(r.reasons).toEqual([]);
  });

  it("el caso de Jonathan: asiste a todo pero casi no usa SCHULE → en riesgo, no 'activa'", () => {
    const r = ev({ schulePct: 5 });
    expect(r.status).toBe("at_risk");
    expect(r.reasons).toEqual(["Ejercicios de SCHULE: lleva 5 % y a estas alturas debería ir por el 43 %."]);
  });

  it("10 puntos de margen sobre lo esperado", () => {
    expect(ev({ schulePct: 33 }).status).toBe("active");    // 43 − 10
    expect(ev({ schulePct: 32 }).status).toBe("at_risk");
  });

  it("recién empezado: no se le exige nada de SCHULE todavía", () => {
    const r = ev({ held: 3, attended: 3, schulePct: 0, levelFraction: 3 / 32 });
    expect(r.expectedSchulePct).toBe(8);
    expect(r.status).toBe("active");
  });

  it("sin dato de SCHULE no se da por bueno", () => {
    const r = ev({ schulePct: null });
    expect(r.status).toBe("at_risk");
    expect(r.schuleUnknown).toBe(true);
    expect(r.reasons).toEqual(["Ejercicios de SCHULE: sin datos todavía."]);
  });

  it("asistencia por debajo del 85 % (umbral del contrato, antes 80 %)", () => {
    const r = ev({ held: 20, attended: 16, totalClasses: 92, levelFraction: 0.2, schulePct: 30 });   // 80 %
    expect(r.attendanceRate).toBe(80);
    expect(r.status).toBe("at_risk");
    expect(r.reasons[0]).toBe("Asistencia: 80 % (mínimo 85 %).");
    expect(legacyGarantiaStatus(80, null)).toBe("active");   // lo que decía antes
  });

  it("ya no puede llegar al 85 % aunque asista a todo lo que queda → no cumple", () => {
    // 32 clases: admite 4 faltas (87,5 %). Con 5 faltas el máximo es 84,4 %.
    const ok = ev({ held: 10, attended: 6, totalClasses: 32 });
    expect(ok.status).toBe("at_risk");                        // 4 faltas: aún puede
    const lost = ev({ held: 10, attended: 5, totalClasses: 32 });
    expect(lost.status).toBe("lost");
    expect(lost.reasons[0]).toBe("Asistencia: ha faltado a 5 de 32 clases; ya no puede llegar al 85 %.");
  });

  it("por SCHULE nunca se pierde a mitad de curso: se puede poner al día hasta la última clase", () => {
    expect(ev({ held: 30, attended: 30, schulePct: 0, levelFraction: 30 / 32 }).status).toBe("at_risk");
  });

  it("programa terminado: se comprueba el 85 / 85 definitivo", () => {
    expect(ev({ held: 32, attended: 30, schulePct: 90, levelFraction: 1 })).toMatchObject({ status: "active", programFinished: true, expectedSchulePct: 85 });
    const r = ev({ held: 32, attended: 30, schulePct: 60, levelFraction: 1 });
    expect(r.status).toBe("lost");
    expect(r.reasons).toEqual(["Ejercicios de SCHULE: terminó con 60 % (mínimo 85 %)."]);
    expect(ev({ held: 32, attended: 30, schulePct: 80, levelFraction: 1 }).status).toBe("lost");   // en el cierre no hay margen
  });

  it("sin total de clases: se valora la asistencia y SCHULE solo informa", () => {
    const r = ev({ totalClasses: null, levelFraction: null, schulePct: 10 });
    expect(r.expectedSchulePct).toBeNull();
    expect(r.status).toBe("active");
    expect(ev({ totalClasses: null, levelFraction: null, held: 10, attended: 4 }).status).toBe("at_risk");
  });

  it("84,62 % no se muestra como 85 %", () => {
    const r = ev({ held: 13, attended: 11, totalClasses: 92, levelFraction: 0.4, schulePct: 40 });
    expect(r.status).toBe("at_risk");
    expect(r.reasons[0]).toBe("Asistencia: 84,6 % (mínimo 85 %).");
    expect(formatGarantiaPct(84.99)).toBe("84,9");
    expect(formatGarantiaPct(85)).toBe("85");
  });

  it("varios motivos a la vez", () => {
    const r = ev({ held: 20, attended: 16, totalClasses: 92, levelFraction: 0.65, schulePct: 10 });
    expect(r.reasons).toHaveLength(2);
  });
});
