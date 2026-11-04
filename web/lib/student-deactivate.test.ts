import { describe, expect, it } from "vitest";
import { isIndividualGroup, partitionFutureClasses, type FutureClassRow, type GroupInfo } from "./student-deactivate";

const row = (over: Partial<FutureClassRow>): FutureClassRow => ({
  classId: "c1",
  groupId: null,
  teacherUserId: "t-simon",
  teacherName: "Simon",
  teacherPhone: "+491510000000",
  ...over,
});

describe("isIndividualGroup", () => {
  it("grupo individual de post-conversion-flow (class_type individual, capacity 1)", () => {
    expect(isIndividualGroup({ class_type: "individual", capacity: 1 })).toBe(true);
  });
  it("capacity 1 basta aunque class_type sea group", () => {
    expect(isIndividualGroup({ class_type: "group", capacity: 1 })).toBe(true);
  });
  it("dúo / trío / grupo no son individuales", () => {
    expect(isIndividualGroup({ class_type: "group", capacity: 2 })).toBe(false);
    expect(isIndividualGroup({ class_type: "group", capacity: 3 })).toBe(false);
    expect(isIndividualGroup({ class_type: "group", capacity: null })).toBe(false);
  });
  it("sin grupo conocido → false", () => {
    expect(isIndividualGroup(null)).toBe(false);
    expect(isIndividualGroup(undefined)).toBe(false);
  });
});

describe("partitionFutureClasses (baja de alumno, 2026-11-03)", () => {
  const groups = new Map<string, GroupInfo>([
    ["g-indiv", { class_type: "individual", capacity: 1 }],
    ["g-duo",   { class_type: "group", capacity: 2 }],
  ]);

  it("clase sin group_id → se cancela", () => {
    const p = partitionFutureClasses([row({ classId: "c1", groupId: null })], groups);
    expect(p.individualIds).toEqual(["c1"]);
    expect(p.groupClassIds).toEqual([]);
  });

  it("clase 1:1 con el grupo individual del alumno → se cancela (caso clase 02f62825 del 10/11)", () => {
    const p = partitionFutureClasses([row({ classId: "c-1on1", groupId: "g-indiv" })], groups);
    expect(p.individualIds).toEqual(["c-1on1"]);
    expect(p.groupClassIds).toEqual([]);
  });

  it("clase de dúo → solo se quita al alumno del roster", () => {
    const p = partitionFutureClasses([row({ classId: "c-duo", groupId: "g-duo" })], groups);
    expect(p.individualIds).toEqual([]);
    expect(p.groupClassIds).toEqual(["c-duo"]);
  });

  it("group_id desconocido → se trata como grupo real (comportamiento anterior)", () => {
    const p = partitionFutureClasses([row({ classId: "c-x", groupId: "g-missing" })], groups);
    expect(p.individualIds).toEqual([]);
    expect(p.groupClassIds).toEqual(["c-x"]);
  });

  it("agrupa avisos por profe y cuenta clases; profe sin teléfono no se avisa", () => {
    const p = partitionFutureClasses([
      row({ classId: "c1", groupId: "g-indiv" }),
      row({ classId: "c2", groupId: "g-indiv" }),
      row({ classId: "c3", groupId: "g-duo", teacherUserId: "t-sabine", teacherName: "Sabine", teacherPhone: "+491520000000" }),
      row({ classId: "c4", groupId: null, teacherUserId: "t-nophone", teacherName: "Sin Tel", teacherPhone: null }),
    ], groups);
    expect(p.individualIds).toEqual(["c1", "c2", "c4"]);
    expect(p.groupClassIds).toEqual(["c3"]);
    expect(p.teacherNotifs.size).toBe(2);
    expect(p.teacherNotifs.get("t-simon")).toEqual({ phone: "+491510000000", teacherName: "Simon", n: 2 });
    expect(p.teacherNotifs.get("t-sabine")).toEqual({ phone: "+491520000000", teacherName: "Sabine", n: 1 });
  });

  it("profe sin nombre → 'Profesor'", () => {
    const p = partitionFutureClasses([row({ teacherName: null })], groups);
    expect(p.teacherNotifs.get("t-simon")?.teacherName).toBe("Profesor");
  });
});
