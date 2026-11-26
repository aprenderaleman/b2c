import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabaseAdmin: () => { throw new Error("sin BD en este test"); } }));

import { formatPct, parseCommissionPct, rangoForPct, resolveCommission } from "./teacher-commission";

describe("parseCommissionPct", () => {
  it("acepta números libres, con coma o punto", () => {
    expect(parseCommissionPct(8)).toBe(8);
    expect(parseCommissionPct("8")).toBe(8);
    expect(parseCommissionPct("12,5")).toBe(12.5);
    expect(parseCommissionPct(" 7.25 ")).toBe(7.25);
    expect(parseCommissionPct(0)).toBe(0);
    expect(parseCommissionPct("8.00")).toBe(8);
  });
  it("redondea a 2 decimales", () => { expect(parseCommissionPct("8.3333")).toBe(8.33); });
  it("vacío, texto o fuera de 0–100 → null", () => {
    for (const v of [null, undefined, "", "abc", -1, 101, "200", NaN]) expect(parseCommissionPct(v)).toBeNull();
  });
});

describe("rangoForPct (solo etiqueta)", () => {
  it("el rango más alto cuyo % no supera el acordado", () => {
    expect(rangoForPct(8)).toBe("starter");
    expect(rangoForPct(5)).toBe("starter");
    expect(rangoForPct(10)).toBe("pro");
    expect(rangoForPct(11.5)).toBe("pro");
    expect(rangoForPct(12)).toBe("elite");
    expect(rangoForPct(15)).toBe("master");
    expect(rangoForPct(20)).toBe("master");
  });
});

describe("resolveCommission", () => {
  it("la comisión acordada manda sobre el rango", () => {
    expect(resolveCommission({ customPct: 8, rango: "pro", rangoPct: 10 })).toEqual({ pct: 8, rango: "pro", custom: true });
    expect(resolveCommission({ customPct: "8.00", rango: "starter", rangoPct: 5 })).toEqual({ pct: 8, rango: "starter", custom: true });
  });
  it("un 0 % acordado es un acuerdo válido (no cae al rango)", () => {
    expect(resolveCommission({ customPct: 0, rango: "pro", rangoPct: 10 })).toEqual({ pct: 0, rango: "pro", custom: true });
  });
  it("sin acuerdo → la del rango", () => {
    expect(resolveCommission({ customPct: null, rango: "master", rangoPct: 15 })).toEqual({ pct: 15, rango: "master", custom: false });
  });
  it("sin acuerdo ni rango configurado → 5 % (starter), como antes", () => {
    expect(resolveCommission({ customPct: null, rango: null, rangoPct: null })).toEqual({ pct: 5, rango: "starter", custom: false });
  });
  it("un valor acordado inválido se ignora", () => {
    expect(resolveCommission({ customPct: "abc", rango: "pro", rangoPct: 10 })).toEqual({ pct: 10, rango: "pro", custom: false });
  });
});

describe("formatPct", () => {
  it("formato español", () => {
    expect(formatPct(8)).toBe("8 %");
    expect(formatPct(12.5)).toBe("12,5 %");
  });
});
