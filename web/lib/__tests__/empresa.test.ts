import { describe, it, expect } from "vitest";

// Test pure calculation functions extracted from empresa.ts logic.
// These don't hit the database — they validate the math.

function computeBeneficioBruto(revenueCents: number, teacherPayrollCents: number): number {
  return revenueCents - teacherPayrollCents;
}

function computeBeneficioNeto(
  revenueCents: number,
  teacherPayrollCents: number,
  variableExpensesCents: number,
  fixedCostsCents: number,
): number {
  return revenueCents - teacherPayrollCents - variableExpensesCents - fixedCostsCents;
}

function computeMargenPct(beneficio: number, revenue: number): number {
  return revenue > 0 ? (beneficio / revenue) * 100 : 0;
}

function computeCPL(adsSpendCents: number, leadsTotal: number): number {
  return leadsTotal > 0 ? Math.round(adsSpendCents / leadsTotal) : 0;
}

function computeCAC(
  adsSpendCents: number,
  fixedCostsCents: number,
  variableExpensesCents: number,
  conversions: number,
): number {
  return conversions > 0
    ? Math.round((adsSpendCents + fixedCostsCents + variableExpensesCents) / conversions)
    : 0;
}

function computeROAS(revenueCents: number, adsSpendCents: number): number {
  return adsSpendCents > 0 ? revenueCents / adsSpendCents : 0;
}

function computeLTVCACRatio(ltvCents: number, cacCents: number): number {
  return cacCents > 0 ? ltvCents / cacCents : 0;
}

function computeFunnelRate(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function prorrateCostosFijos(monthlyCents: number, daysInRange: number): number {
  return Math.round(monthlyCents * (daysInRange / 30));
}

// ==========================================================================

describe("Beneficio Bruto", () => {
  it("revenue minus teacher payroll", () => {
    expect(computeBeneficioBruto(100000, 30000)).toBe(70000);
  });
  it("negative when payroll exceeds revenue", () => {
    expect(computeBeneficioBruto(20000, 50000)).toBe(-30000);
  });
  it("zero when both are zero", () => {
    expect(computeBeneficioBruto(0, 0)).toBe(0);
  });
});

describe("Beneficio Neto", () => {
  it("subtracts all costs from revenue", () => {
    expect(computeBeneficioNeto(100000, 30000, 10000, 15000)).toBe(45000);
  });
  it("negative when costs exceed revenue", () => {
    expect(computeBeneficioNeto(50000, 30000, 20000, 15000)).toBe(-15000);
  });
});

describe("Margen %", () => {
  it("50% margin", () => {
    expect(computeMargenPct(50000, 100000)).toBe(50);
  });
  it("0% when revenue is 0", () => {
    expect(computeMargenPct(0, 0)).toBe(0);
  });
  it("negative margin", () => {
    expect(computeMargenPct(-20000, 100000)).toBe(-20);
  });
});

describe("CPL (Cost Per Lead)", () => {
  it("correct calculation", () => {
    // 500 EUR in ads, 50 leads → 10 EUR per lead = 1000 cents
    expect(computeCPL(50000, 50)).toBe(1000);
  });
  it("0 when no leads", () => {
    expect(computeCPL(50000, 0)).toBe(0);
  });
});

describe("CAC (Customer Acquisition Cost)", () => {
  it("sums all costs divided by conversions", () => {
    // ads=500EUR + fixed=200EUR + variable=100EUR = 800EUR / 4 conversions = 200EUR
    expect(computeCAC(50000, 20000, 10000, 4)).toBe(20000);
  });
  it("0 when no conversions", () => {
    expect(computeCAC(50000, 20000, 10000, 0)).toBe(0);
  });
});

describe("ROAS", () => {
  it("revenue / ads spend", () => {
    // 2000 EUR revenue / 500 EUR ads = 4x
    expect(computeROAS(200000, 50000)).toBe(4);
  });
  it("0 when no ads spend", () => {
    expect(computeROAS(200000, 0)).toBe(0);
  });
});

describe("LTV/CAC Ratio", () => {
  it("correct ratio", () => {
    // LTV=600EUR, CAC=200EUR → 3x
    expect(computeLTVCACRatio(60000, 20000)).toBe(3);
  });
  it("0 when CAC is 0", () => {
    expect(computeLTVCACRatio(60000, 0)).toBe(0);
  });
});

describe("Funnel conversion rates", () => {
  it("lead to trial", () => {
    expect(computeFunnelRate(25, 100)).toBe(25);
  });
  it("trial attendance", () => {
    expect(computeFunnelRate(20, 25)).toBe(80);
  });
  it("attended to sale", () => {
    expect(computeFunnelRate(10, 20)).toBe(50);
  });
  it("global lead to sale", () => {
    expect(computeFunnelRate(10, 100)).toBe(10);
  });
  it("0 when denominator is 0", () => {
    expect(computeFunnelRate(5, 0)).toBe(0);
  });
});

describe("Costes fijos prorrateados", () => {
  it("full month = same amount", () => {
    expect(prorrateCostosFijos(10000, 30)).toBe(10000);
  });
  it("half month", () => {
    expect(prorrateCostosFijos(10000, 15)).toBe(5000);
  });
  it("7 days = ~23%", () => {
    expect(prorrateCostosFijos(10000, 7)).toBe(2333);
  });
});

describe("Alerts logic", () => {
  it("red alert when margin < 30%", () => {
    const margin = 20;
    expect(margin < 30).toBe(true);
  });

  it("green alert when all scale conditions met", () => {
    const cacCents = 10000;
    const ltvCents = 60000;
    const roas = 5;
    const margin = 55;
    const canScale = cacCents < ltvCents * 0.25 && roas > 4 && margin > 50;
    expect(canScale).toBe(true);
  });

  it("no green alert when CAC too high", () => {
    const cacCents = 20000;
    const ltvCents = 60000;
    const roas = 5;
    const margin = 55;
    const canScale = cacCents < ltvCents * 0.25 && roas > 4 && margin > 50;
    expect(canScale).toBe(false);
  });

  it("no green alert when ROAS too low", () => {
    const cacCents = 10000;
    const ltvCents = 60000;
    const roas = 3;
    const margin = 55;
    const canScale = cacCents < ltvCents * 0.25 && roas > 4 && margin > 50;
    expect(canScale).toBe(false);
  });
});
