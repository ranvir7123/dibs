import { describe, expect, it } from "vitest";
import { formatCents, isCents } from "./money";

describe("formatCents", () => {
  it("writes whole cents as dollars", () => {
    expect(formatCents(1240)).toBe("$12.40");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5000)).toBe("$50.00");
    expect(formatCents(5)).toBe("$0.05");
  });

  it("puts commas in large amounts", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("refuses an amount that is not whole cents", () => {
    expect(() => formatCents(12.5)).toThrow("whole cents");
    expect(() => formatCents(-1)).toThrow("whole cents");
  });
});

describe("isCents", () => {
  it("accepts only whole numbers from zero up", () => {
    expect(isCents(1240)).toBe(true);
    expect(isCents(0)).toBe(true);
    expect(isCents(12.4)).toBe(false);
    expect(isCents(-1)).toBe(false);
    expect(isCents("1240")).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
  });
});
