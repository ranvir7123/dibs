/**
 * Our own tracked links. Every click on /r/<code> is stored. A click counts
 * as real unless the same visitor already clicked, or it arrived inside a
 * machine-speed burst; then it is stored as left out, with the reason.
 * Plain code, no AI.
 */
import { createHmac } from "node:crypto";
import { and, asc, count, countDistinct, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { newId } from "@/db/ids";
import { clicks, trackedLinks } from "@/db/schema";
import { settings } from "@/settings";

export const REPEAT_REASON = "The same visitor clicked again.";
export const burstReason = () =>
  `Part of a burst: more than ${settings.cheatTests.clickBurst.maxClicksInWindow} clicks arrived within ${settings.cheatTests.clickBurst.windowSeconds} seconds.`;

/**
 * A scrambled mark for a visitor, the same every time the same visitor
 * clicks. Their raw address is never stored and cannot be worked back from it.
 */
export function visitorKeyFor(address: string, browser: string): string {
  const secret = process.env.TICK_SECRET?.trim() || "dibs-local-visitor-mark";
  return createHmac("sha256", secret).update(`${address}\n${browser}`).digest("hex").slice(0, 32);
}

/** The visitor's mark from a web request's headers. */
export function visitorKeyFromHeaders(headers: Headers): string {
  // The web host writes the first two itself, so a visitor cannot make them up. The last is the fallback on a laptop.
  const address =
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown-address";
  return visitorKeyFor(address, headers.get("user-agent") ?? "");
}

export interface ClickOutcome {
  targetUrl: string;
  counted: boolean;
  leftOutReason: string | null;
}

/**
 * Stores one click on a tracked link and decides whether it counts.
 * Returns null for a code that does not exist.
 */
export async function recordClick(code: string, visitorKey: string, at: Date = new Date()): Promise<ClickOutcome | null> {
  const db = await getDb();
  const link = (await db.select().from(trackedLinks).where(eq(trackedLinks.code, code)))[0];
  if (!link) return null;

  const { repeatVisitor, clickBurst } = settings.cheatTests;
  return db.transaction(async (tx) => {
    // One click at a time per link, so two clicks landing together cannot both count.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${code}))`);

    const fromThisVisitor = (
      await tx
        .select({ n: count() })
        .from(clicks)
        .where(and(eq(clicks.linkCode, code), eq(clicks.visitorKey, visitorKey), eq(clicks.counted, true)))
    )[0].n;

    let leftOutReason: string | null = null;
    if (fromThisVisitor >= repeatVisitor.countedClicksPerVisitor) {
      leftOutReason = REPEAT_REASON;
    } else {
      const windowStart = new Date(at.getTime() - clickBurst.windowSeconds * 1000);
      const inWindow = (
        await tx
          .select({ n: count() })
          .from(clicks)
          .where(and(eq(clicks.linkCode, code), gte(clicks.at, windowStart), lte(clicks.at, at)))
      )[0].n;
      if (inWindow >= clickBurst.maxClicksInWindow) leftOutReason = burstReason();
    }

    await tx.insert(clicks).values({ id: newId("clk"), linkCode: code, at, visitorKey, counted: leftOutReason === null, leftOutReason });
    return { targetUrl: link.targetUrl, counted: leftOutReason === null, leftOutReason };
  });
}

export interface Burst {
  /** When the busiest window began. */
  startedAt: Date;
  /** Clicks inside that window. */
  clicks: number;
  /** Seconds from the first to the last click in it. */
  seconds: number;
}

/** The busiest stretch of clicks no longer than the burst window. Pure: takes click times, oldest first. */
export function busiestWindow(times: Date[], windowSeconds: number): Burst | null {
  let best: Burst | null = null;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    while (times[end].getTime() - times[start].getTime() > windowSeconds * 1000) start++;
    const n = end - start + 1;
    if (!best || n > best.clicks) {
      best = { startedAt: times[start], clicks: n, seconds: Math.ceil((times[end].getTime() - times[start].getTime()) / 1000) };
    }
  }
  return best;
}

export interface ClickCounts {
  /** Every click, cheats included. */
  clicksTotal: number;
  /** Clicks that count. */
  clicksReal: number;
  /** Different visitors. */
  visitors: number;
  /** Clicks left out because the visitor had already clicked. */
  repeats: number;
  /** The busiest stretch, when it was more than the settings allow. Null when there was no burst. */
  burst: Burst | null;
  /** The most clicks any one visitor made. */
  mostFromOneVisitor: number;
}

/** Adds up a tracked link's clicks. */
export async function countClicks(code: string): Promise<ClickCounts> {
  const db = await getDb();
  const totals = (
    await db
      .select({
        total: count(),
        real: sql<number>`count(*) filter (where ${clicks.counted})`.mapWith(Number),
        visitors: countDistinct(clicks.visitorKey),
        repeats: sql<number>`count(*) filter (where ${clicks.leftOutReason} = ${REPEAT_REASON})`.mapWith(Number),
      })
      .from(clicks)
      .where(eq(clicks.linkCode, code))
  )[0];
  const top = (
    await db
      .select({ n: count() })
      .from(clicks)
      .where(eq(clicks.linkCode, code))
      .groupBy(clicks.visitorKey)
      .orderBy(sql`count(*) desc`)
      .limit(1)
  )[0];
  const times = (await db.select({ at: clicks.at }).from(clicks).where(eq(clicks.linkCode, code)).orderBy(asc(clicks.at))).map((r) => r.at);
  const { windowSeconds, maxClicksInWindow } = settings.cheatTests.clickBurst;
  const busiest = busiestWindow(times, windowSeconds);
  return {
    clicksTotal: totals.total,
    clicksReal: totals.real,
    visitors: totals.visitors,
    repeats: totals.repeats,
    burst: busiest && busiest.clicks > maxClicksInWindow ? busiest : null,
    mostFromOneVisitor: top?.n ?? 0,
  };
}

/**
 * The address a tracked link sends its visitor on to: the poster's page with
 * the worker's code added as "ref", keeping whatever the address already
 * carried. The shop reads "ref" to put the worker's code on the PayPal order,
 * which is how a sale is counted for the right worker.
 */
export function onwardAddress(targetUrl: string, code: string): string {
  try {
    const url = new URL(targetUrl);
    url.searchParams.set("ref", code);
    return url.toString();
  } catch {
    return targetUrl; // not a full web address: send the visitor on as it is
  }
}
