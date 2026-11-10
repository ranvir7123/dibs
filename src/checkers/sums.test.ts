import { describe, expect, it } from "vitest";
import type { JobCard } from "@/contract/types";
import { settings } from "@/settings";
import { clicksLookReal, viewsLookReal } from "./cheat-tests";
import { busiestWindow, type ClickCounts } from "./clicks";
import { earnedFor } from "./pay";
import { secondsFromIsoDuration, statsFromOfficial, statsFromPage, videoIdFrom } from "./video-site";
import { secondsFromClock } from "./watch";

const jump = settings.cheatTests.viewJump;
const quiet = settings.cheatTests.viewsWithoutLikes;
const burst = settings.cheatTests.clickBurst;
const all = ["view_jump", "views_without_likes", "repeat_visitor", "click_burst", "clicks_against_views"] as const;

describe("views look real", () => {
  it("passes steady views with likes", () => {
    const r = viewsLookReal({ views: 6200, likes: 412, previousViews: 6100, tests: [...all] });
    expect(r).toEqual({ passed: true, reason: "Views grew steadily and came with likes: 6.6 for every 100 views.", headline: null });
  });
  it("holds nothing against a video with too few views to judge", () => {
    expect(viewsLookReal({ views: 140, likes: 3, previousViews: 100, tests: [...all] }).reason).toBe("140 views with 3 likes. Too few views to judge, so nothing is held against them.");
  });
  it("fails a jump just over the limit and passes one exactly on it", () => {
    const before = jump.minViewsBeforeTesting;
    expect(viewsLookReal({ views: before * jump.maxGrowthBetweenReadings, likes: 500, previousViews: before, tests: [...all] }).passed).toBe(true);
    const over = viewsLookReal({ views: before * jump.maxGrowthBetweenReadings + 1, likes: 500, previousViews: before, tests: [...all] });
    expect(over.passed).toBe(false);
    expect(over.headline).toContain("Views jumped");
  });
  it("does not call the first views of a new video a jump", () => {
    expect(viewsLookReal({ views: 50_000, likes: 3000, previousViews: jump.minViewsBeforeTesting - 1, tests: [...all] }).passed).toBe(true);
    expect(viewsLookReal({ views: 50_000, likes: 3000, previousViews: null, tests: [...all] }).passed).toBe(true);
  });
  it("fails views that come with almost no likes, and does not let hidden likes dodge the test", () => {
    const views = quiet.minViewsBeforeTesting * 10;
    const fewLikes = Math.ceil((views * quiet.minLikesPer100Views) / 100) - 1;
    expect(viewsLookReal({ views, likes: fewLikes, previousViews: views, tests: [...all] }).passed).toBe(false);
    expect(viewsLookReal({ views, likes: fewLikes + 1, previousViews: views, tests: [...all] }).passed).toBe(true);
    expect(viewsLookReal({ views, likes: null, previousViews: views, tests: [...all] })).toMatchObject({ passed: false, headline: "Likes are hidden" });
    // Too few views to judge, or a job that does not use the likes test: hidden likes are not held against anyone.
    expect(viewsLookReal({ views: quiet.minViewsBeforeTesting - 1, likes: null, previousViews: null, tests: [...all] }).passed).toBe(true);
    expect(viewsLookReal({ views, likes: null, previousViews: views, tests: ["view_jump"] })).toMatchObject({ passed: true, reason: expect.stringContaining("Likes are hidden") });
  });
  it("runs only the tests the job card lists", () => {
    expect(viewsLookReal({ views: 100_000, likes: 0, previousViews: 1000, tests: [] }).passed).toBe(true);
  });
});

const counts = (over: Partial<ClickCounts>): ClickCounts => ({ clicksTotal: 0, clicksReal: 0, visitors: 0, repeats: 0, burst: null, mostFromOneVisitor: 0, ...over });

describe("clicks look real", () => {
  it("passes honest clicks and says how many repeats were left out", () => {
    const r = clicksLookReal({ counts: counts({ clicksTotal: 184, clicksReal: 181, visitors: 181, repeats: 3, mostFromOneVisitor: 2 }), views: 6200, tests: [...all] });
    expect(r).toEqual({ passed: true, reason: "181 of 184 clicks came from different visitors. 3 repeat clicks were left out.", headline: null });
  });
  it("fails 5,000 clicks from one visitor, in the drawing's words", () => {
    const r = clicksLookReal({
      counts: counts({ clicksTotal: 5000, clicksReal: 1, visitors: 1, repeats: 4999, mostFromOneVisitor: 5000, burst: { startedAt: new Date(), clicks: 5000, seconds: 40 } }),
      views: 140,
      tests: [...all],
    });
    expect(r).toEqual({ passed: false, reason: "All 5,000 clicks arrived in 40 seconds from the same visitor. They were counted as 1 click.", headline: "One visitor, 5,000 clicks" });
  });
  it("fails far more clicks than the views could send", () => {
    const limit = settings.cheatTests.clicksAgainstViews.maxClicksPer100Views;
    expect(clicksLookReal({ counts: counts({ clicksTotal: limit * 2, clicksReal: limit * 2 }), views: 200, tests: [...all] }).passed).toBe(true);
    expect(clicksLookReal({ counts: counts({ clicksTotal: limit * 2 + 1, clicksReal: limit * 2 + 1 }), views: 200, tests: [...all] }).passed).toBe(false);
  });
  it("finds the busiest stretch of clicks", () => {
    const t0 = Date.UTC(2026, 10, 10);
    const times = [0, 1000, 2000, (burst.windowSeconds + 5) * 1000].map((ms) => new Date(t0 + ms));
    expect(busiestWindow(times, burst.windowSeconds)).toMatchObject({ clicks: 3, seconds: 2 });
    expect(busiestWindow([], burst.windowSeconds)).toBeNull();
  });
});

const card = (payRule: JobCard["payRule"], capCents = 5000) => ({ payRule, capCents }) as JobCard;

describe("what a result earned", () => {
  it("pays views in proportion: 6,200 views at $2.00 per 1,000 is $12.40", () => {
    expect(earnedFor(card({ kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 200, batchSize: 1000 }), { views: 6200 }, false)).toBe(1240);
  });
  it("counts only real clicks, and never pays more than the cap", () => {
    const perClick = card({ kind: "per_unit", unit: "click", unitLabel: "clicks", centsPerBatch: 10, batchSize: 1 });
    expect(earnedFor(perClick, { clicksTotal: 5000, clicksReal: 1 }, false)).toBe(10);
    expect(earnedFor(perClick, { clicksReal: 99_999 }, false)).toBe(5000);
  });
  it("pays per rule passed, and a one-off only when the finish line is met", () => {
    expect(earnedFor(card({ kind: "per_rule", centsPerRule: 300, rules: [] }, 6000), { rulesPassed: 4, rulesTotal: 5 }, false)).toBe(1200);
    expect(earnedFor(card({ kind: "once", cents: 1800 }), {}, false)).toBe(0);
    expect(earnedFor(card({ kind: "once", cents: 1800 }), {}, true)).toBe(1800);
  });
});

describe("reading the video site", () => {
  it("finds the video id in every usual kind of link", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      "https://youtu.be/jNQXAC9IVRw?si=abc",
      "https://m.youtube.com/watch?feature=share&v=jNQXAC9IVRw",
      "https://www.youtube.com/shorts/jNQXAC9IVRw",
      "https://www.youtube.com/embed/jNQXAC9IVRw",
    ]) {
      expect(videoIdFrom(link)).toBe("jNQXAC9IVRw");
    }
    for (const link of ["https://video.example.com/watch/aarav-kettle-launch", "https://www.youtube.com/watch?v=short", "not a link", "https://evil.example/youtube.com/watch?v=jNQXAC9IVRw"]) {
      expect(videoIdFrom(link)).toBeNull();
    }
  });

  // EXAMPLE of the official address's answer, written from Google's documented shape. Not a recorded real answer.
  const EXAMPLE_OFFICIAL = {
    items: [{ statistics: { viewCount: "6200", likeCount: "412", commentCount: "38" }, status: { privacyStatus: "public" }, contentDetails: { duration: "PT4M13S" } }],
  };
  it("reads the official answer (EXAMPLE shape)", () => {
    expect(statsFromOfficial("jNQXAC9IVRw", EXAMPLE_OFFICIAL)).toEqual({ videoId: "jNQXAC9IVRw", views: 6200, likes: 412, comments: 38, seconds: 253, source: "official" });
    expect(statsFromOfficial("jNQXAC9IVRw", { items: [{ statistics: { viewCount: "10" }, status: { privacyStatus: "public" } }] })).toMatchObject({ views: 10, likes: null, comments: null, seconds: null });
  });
  it("refuses a video that is missing, private or unlisted", () => {
    expect(() => statsFromOfficial("jNQXAC9IVRw", { items: [] })).toThrow("Only a public video can be checked");
    expect(() => statsFromOfficial("jNQXAC9IVRw", { items: [{ statistics: { viewCount: "5" }, status: { privacyStatus: "unlisted" } }] })).toThrow("Only a public video");
    expect(() => statsFromPage("jNQXAC9IVRw", '"isPrivate":true,"viewCount":"5"')).toThrow("Only a public video");
    expect(() => statsFromPage("jNQXAC9IVRw", "<html>nothing here</html>")).toThrow("did not show a view count");
  });
  it("reads the public page (pieces copied from the real page on 10 Nov 2026)", () => {
    const piece = '"playabilityStatus":{"status":"OK"},"lengthSeconds":"19","isPrivate":false,"viewCount":"448163335","isUnlisted":false,"likeCount":"20133149"';
    expect(statsFromPage("jNQXAC9IVRw", piece)).toEqual({ videoId: "jNQXAC9IVRw", views: 448163335, likes: 20133149, comments: null, seconds: 19, source: "page" });
  });
  it("turns lengths and clock times into seconds", () => {
    expect(secondsFromIsoDuration("PT19S")).toBe(19);
    expect(secondsFromIsoDuration("PT1H2M3S")).toBe(3723);
    expect(secondsFromClock("01:31")).toBe(91);
    expect(secondsFromClock("1:02:03")).toBe(3723);
    expect(secondsFromClock("")).toBeNull();
    expect(secondsFromClock("about a minute in")).toBeNull();
  });
});
