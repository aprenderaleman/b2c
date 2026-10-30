import { describe, expect, it } from "vitest";
import { classifyInactivity } from "./student-inactivity";

const now = new Date("2026-10-30T09:00:00Z");
const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
const base = { createdAt: d(60), hasFutureClass: false, remaining: 5, subscriptionType: "package", now };

describe("classifyInactivity (umbrales 7/14/30, Gelfis 2026-10-30)", () => {
  it("no avisa si tiene clase futura agendada", () => {
    expect(classifyInactivity({ ...base, lastCompletedAt: d(40), hasFutureClass: true })).toBeNull();
  });
  it("no avisa sin clases restantes (paquete agotado)", () => {
    expect(classifyInactivity({ ...base, lastCompletedAt: d(40), remaining: 0 })).toBeNull();
  });
  it("mensual sin saldo sí cuenta", () => {
    expect(classifyInactivity({ ...base, lastCompletedAt: d(15), remaining: 0, subscriptionType: "monthly_subscription" })).toBe("inactive_14");
  });
  it("nunca empezó: 7 días desde la conversión", () => {
    expect(classifyInactivity({ ...base, createdAt: d(6), lastCompletedAt: null })).toBeNull();
    expect(classifyInactivity({ ...base, createdAt: d(7), lastCompletedAt: null })).toBe("never_started_7");
  });
  it("14 y 30 días sin clase completada", () => {
    expect(classifyInactivity({ ...base, lastCompletedAt: d(13) })).toBeNull();
    expect(classifyInactivity({ ...base, lastCompletedAt: d(14) })).toBe("inactive_14");
    expect(classifyInactivity({ ...base, lastCompletedAt: d(29) })).toBe("inactive_14");
    expect(classifyInactivity({ ...base, lastCompletedAt: d(30) })).toBe("inactive_30");
    expect(classifyInactivity({ ...base, lastCompletedAt: d(85) })).toBe("inactive_30");
  });
});
