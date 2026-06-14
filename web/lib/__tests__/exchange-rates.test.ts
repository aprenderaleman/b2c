import { describe, it, expect } from "vitest";
import { convertToEur } from "../exchange-rates";

describe("convertToEur", () => {
  it("returns same amount for EUR", () => {
    expect(convertToEur(10000, "EUR", 1)).toBe(10000);
  });

  it("converts USD to EUR at 0.92 rate", () => {
    // $100 * 0.92 = 92 EUR = 9200 cents
    expect(convertToEur(10000, "USD", 0.92)).toBe(9200);
  });

  it("converts CHF to EUR at 1.05 rate", () => {
    // 100 CHF * 1.05 = 105 EUR = 10500 cents
    expect(convertToEur(10000, "CHF", 1.05)).toBe(10500);
  });

  it("rounds to nearest cent", () => {
    // $33.33 * 0.92 = 30.6636 → 3066 cents
    expect(convertToEur(3333, "USD", 0.92)).toBe(3066);
  });
});
