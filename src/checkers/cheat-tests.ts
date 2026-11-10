/**
 * The cheat tests that are plain sums. Each takes numbers and returns pass or
 * fail with a plain reason. Every threshold is read from src/settings.ts.
 */
import type { CheatTestKind } from "@/contract/types";
import { settings } from "@/settings";
import type { ClickCounts } from "./clicks";

export interface TestOutcome {
  passed: boolean;
  reason: string;
  /** A short title for a failure, or null. */
  headline: string | null;
}

const n = (value: number) => value.toLocaleString("en-US");
const per100 = (part: number, whole: number) => Math.round((part * 1000) / whole) / 10;

/**
 * "Views look real": a sudden jump between two readings, and views that come
 * with almost no likes. Only the tests the job card lists are run.
 */
export function viewsLookReal(input: {
  views: number;
  /** Null when the owner hides likes. */
  likes: number | null;
  /** The reading before this one, or null on the first reading. */
  previousViews: number | null;
  tests: CheatTestKind[];
}): TestOutcome {
  const { views, likes, previousViews, tests } = input;
  const jump = settings.cheatTests.viewJump;
  const quiet = settings.cheatTests.viewsWithoutLikes;

  if (tests.includes("view_jump") && previousViews !== null && previousViews >= jump.minViewsBeforeTesting && views > previousViews * jump.maxGrowthBetweenReadings) {
    return {
      passed: false,
      reason: `Views jumped from ${n(previousViews)} to ${n(views)} between two readings, more than ${jump.maxGrowthBetweenReadings} times as many. Real views do not arrive like that.`,
      headline: `Views jumped from ${n(previousViews)} to ${n(views)}`,
    };
  }

  if (tests.includes("views_without_likes") && likes !== null && views >= quiet.minViewsBeforeTesting && (likes * 100) / views < quiet.minLikesPer100Views) {
    return {
      passed: false,
      reason: `${n(views)} views came with only ${n(likes)} likes. Real viewers leave at least ${quiet.minLikesPer100Views} likes for every 100 views.`,
      headline: `${n(views)} views, ${n(likes)} likes`,
    };
  }

  if (tests.includes("views_without_likes") && likes === null && views >= quiet.minViewsBeforeTesting) {
    return {
      passed: false,
      reason: `Likes are hidden on this video, so its ${n(views)} views cannot be checked. Show the likes and hand the video in again.`,
      headline: "Likes are hidden",
    };
  }

  const smallest = Math.min(jump.minViewsBeforeTesting, quiet.minViewsBeforeTesting);
  if (views < smallest) {
    return {
      passed: true,
      reason: `${n(views)} views${likes === null ? "" : ` with ${n(likes)} likes`}. Too few views to judge, so nothing is held against them.`,
      headline: null,
    };
  }
  if (likes === null) return { passed: true, reason: `Views grew steadily. Likes are hidden on this video, so the likes test was skipped.`, headline: null };
  return { passed: true, reason: `Views grew steadily and came with likes: ${per100(likes, views)} for every 100 views.`, headline: null };
}

/**
 * "Clicks look real": a machine-speed burst, repeat visitors, and far more
 * clicks than the video's views could produce.
 */
export function clicksLookReal(input: { counts: ClickCounts; views: number | null; tests: CheatTestKind[] }): TestOutcome {
  const { counts, views, tests } = input;
  const { clicksTotal, clicksReal, repeats, burst, mostFromOneVisitor } = counts;

  if (clicksTotal === 0) return { passed: true, reason: "No clicks yet.", headline: null };

  if (tests.includes("click_burst") && burst) {
    const counted = `They were counted as ${n(clicksReal)} click${clicksReal === 1 ? "" : "s"}.`;
    if (mostFromOneVisitor === clicksTotal) {
      return {
        passed: false,
        reason: `All ${n(clicksTotal)} clicks arrived in ${n(burst.seconds)} seconds from the same visitor. ${counted}`,
        headline: `One visitor, ${n(clicksTotal)} clicks`,
      };
    }
    return {
      passed: false,
      reason: `${n(burst.clicks)} clicks arrived within ${n(burst.seconds)} seconds, faster than people click. ${counted}`,
      headline: `${n(burst.clicks)} clicks in ${n(burst.seconds)} seconds`,
    };
  }

  const limit = settings.cheatTests.clicksAgainstViews.maxClicksPer100Views;
  // "For every 100 views" only means something once there are 100 views.
  if (tests.includes("clicks_against_views") && views !== null && views >= 100 && (clicksReal * 100) / views > limit) {
    return {
      passed: false,
      reason: `${n(clicksReal)} clicks for a video with ${n(views)} views. A video cannot send more than ${limit} clicks for every 100 views.`,
      headline: `${n(clicksReal)} clicks, ${n(views)} views`,
    };
  }

  const leftOut = clicksTotal - clicksReal;
  const tail = leftOut === 0 ? "" : repeats === leftOut ? ` ${n(leftOut)} repeat click${leftOut === 1 ? " was" : "s were"} left out.` : ` ${n(leftOut)} were left out.`;
  return { passed: true, reason: `${n(clicksReal)} of ${n(clicksTotal)} clicks came from different visitors.${tail}`, headline: null };
}
