import { describe, expect, it } from "vitest";
import {
  ago,
  categoryLabel,
  clock,
  compact,
  count,
  dayMonth,
  daysLeftLabel,
  firstName,
  initial,
  paidShare,
  plural,
  sentence,
  tone,
} from "./format";

describe("format", () => {
  it("makes a first name from a handle or a full name", () => {
    expect(firstName("aarav.clips")).toBe("Aarav");
    expect(firstName("Kettle & Clove")).toBe("Kettle");
    expect(firstName("  zoya ")).toBe("Zoya");
    expect(firstName("")).toBe("them");
  });

  it("takes the first letter for the round picture", () => {
    expect(initial("aarav.clips")).toBe("A");
    expect(initial("")).toBe("?");
  });

  it("writes a moment in a recording", () => {
    expect(clock(134)).toBe("02:14");
    expect(clock(0)).toBe("00:00");
    expect(clock(3725)).toBe("62:05");
    expect(clock(null)).toBe("Not seen");
  });

  it("writes big numbers short for the chart", () => {
    expect(compact(8000)).toBe("8K");
    expect(compact(5300)).toBe("5.3K");
    expect(compact(900)).toBe("900");
    expect(compact(1_200_000)).toBe("1.2M");
    expect(compact(0)).toBe("0");
  });

  it("writes counts with commas", () => {
    expect(count(6200)).toBe("6,200");
  });

  it("works out how much of the money bar is green", () => {
    expect(paidShare(1240, 5000)).toBe(24.8);
    expect(paidShare(0, 0)).toBe(0);
    expect(paidShare(0, 4000)).toBe(0);
    expect(paidShare(9000, 4000)).toBe(100);
  });

  it("says how long a job has left", () => {
    expect(daysLeftLabel(9)).toBe("9 days left");
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(0)).toBe("Ends today");
  });

  it("says how long ago something happened", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(ago(new Date(now.getTime() - 20_000), now)).toBe("just now");
    expect(ago(new Date(now.getTime() - 60_000), now)).toBe("1 minute ago");
    expect(ago(new Date(now.getTime() - 120_000), now)).toBe("2 minutes ago");
    expect(ago(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3 hours ago");
    expect(ago(new Date(now.getTime() - 50 * 3_600_000), now)).toBe("2 days ago");
    expect(ago(new Date(now.getTime() - 59.6 * 60_000), now)).toBe("59 minutes ago");
    expect(ago(new Date(now.getTime() - 23.6 * 3_600_000), now)).toBe("23 hours ago");
  });

  it("writes a day in India time", () => {
    expect(dayMonth(new Date("2026-11-10T06:00:00Z"))).toBe("10 Nov");
    // 8 pm in London on the 10th is already the 11th in India.
    expect(dayMonth(new Date("2026-11-10T20:00:00Z"))).toBe("11 Nov");
  });

  it("gives each person the colour the drawing gave them", () => {
    expect(tone("Kettle & Clove")).toBe("a1");
    expect(tone("Loom & Thread")).toBe("a2");
    expect(tone("Tiny Comet Games")).toBe("a3");
    expect(tone("Northside Bakes")).toBe("a4");
    expect(tone("aarav.clips")).toBe("a1");
    expect(tone("meera.reels")).toBe("a2");
    expect(tone("zoya.plays")).toBe("a3");
    expect(["a1", "a2", "a3", "a4"]).toContain(tone("someone new"));
  });

  it("names the board tabs", () => {
    expect(categoryLabel("other")).toBe("Anything else");
    expect(categoryLabel("promotion")).toBe("Promotion");
  });

  it("picks one or many", () => {
    expect(plural(1, "rule")).toBe("1 rule");
    expect(plural(4, "rule")).toBe("4 rules");
    expect(plural(1200, "view")).toBe("1,200 views");
  });

  it("ends a line with exactly one full stop", () => {
    expect(sentence("Up to 10 sales are paid.")).toBe("Up to 10 sales are paid.");
    expect(sentence("10,000 views on your launch video ")).toBe("10,000 views on your launch video.");
    expect(sentence("Is this bug real?")).toBe("Is this bug real?");
    expect(sentence("  ")).toBe("");
  });
});
