import { describe, expect, it } from "vitest";
import { settings } from "./settings";

describe("settings", () => {
  it("starts with the numbers agreed in the design", () => {
    expect(settings.payBatchMinutes).toBe(60);
    expect(settings.objectionWindowDays).toBe(3);
    expect(settings.maxJobDays).toBe(21);
    expect(settings.feePercent).toBe(10);
    expect(settings.checkEveryMinutes).toBe(10);
  });

  it("keeps a job shorter than a PayPal hold lasts", () => {
    expect(settings.maxJobDays).toBeLessThanOrEqual(settings.holdMaxDays);
  });

  it("has a positive number for every cheat-test threshold", () => {
    const numbers = Object.values(settings.cheatTests).flatMap((test) => Object.values(test));
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(typeof n).toBe("number");
      expect(n).toBeGreaterThan(0);
    }
  });
});
