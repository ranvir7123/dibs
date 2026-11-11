import { describe, expect, it } from "vitest";
import { chartModel, roundTop } from "./chart";

const at = (hoursAgo: number, now: Date) => new Date(now.getTime() - hoursAgo * 3_600_000);

describe("chart", () => {
  it("picks a round number at or above the biggest value", () => {
    expect(roundTop(6200)).toBe(9000);
    expect(roundTop(5000)).toBe(6000);
    expect(roundTop(181)).toBe(300);
    expect(roundTop(4)).toBe(6);
    expect(roundTop(0)).toBe(3);
    expect(roundTop(3)).toBe(3);
  });

  it("draws nothing from fewer than two readings", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(chartModel([], now)).toBeNull();
    expect(chartModel([{ at: now, value: 5 }], now)).toBeNull();
  });

  it("labels readings a few minutes apart with the minutes, so the labels differ", () => {
    const now = new Date("2026-11-10T12:00:00Z"); // 17:30 in India
    const model = chartModel(
      [
        { at: new Date(now.getTime() - 30 * 60_000), value: 0 },
        { at: now, value: 830 },
      ],
      now,
    );
    expect(model!.times).toEqual(["17:00", "17:10", "17:20", "Now"]);
  });

  it("turns readings into a line, a filled shape and labels", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const model = chartModel(
      [
        { at: at(3, now), value: 0 },
        { at: at(2, now), value: 3000 },
        { at: at(1, now), value: 6000 },
        { at: at(0, now), value: 6200 },
      ],
      now,
    );
    expect(model).not.toBeNull();
    expect(model!.ticks).toEqual(["9K", "6K", "3K", "0"]);
    expect(model!.line.startsWith("M0 120")).toBe(true);
    // 6,200 of 9,000 on a 108 tall plot that starts at 12: 120 - 108 * 6200 / 9000 = 45.6
    expect(model!.line.endsWith("360 45.6")).toBe(true);
    expect(model!.area.endsWith("L360 120 L0 120 Z")).toBe(true);
    expect(model!.times).toHaveLength(4);
    expect(model!.times[3]).toBe("Now");
  });

  it("does not break when every reading is at the same moment", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const model = chartModel(
      [
        { at: now, value: 1 },
        { at: now, value: 2 },
      ],
      now,
    );
    expect(model!.line).not.toContain("NaN");
  });
});
