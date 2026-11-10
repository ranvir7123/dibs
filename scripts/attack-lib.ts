/**
 * The working parts of the click attack (scripts/attack.ts):
 * sending the clicks over HTTP, and reading back what Dibs stored and counted.
 */
import { count, eq, sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { clicks, trackedLinks } from "../src/db/schema";

/** The address of a tracked link, as the contract defines it: /r/<code>. */
export function linkUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/r/${encodeURIComponent(code)}`;
}

/** One click. The redirect is not followed: the click is stored by the time the site answers. */
async function click(url: string): Promise<number> {
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "dibs-attack-script" },
    signal: AbortSignal.timeout(30_000), // a site that never answers must not hang the attack
  });
  await response.arrayBuffer(); // finish the answer so the connection can be used again
  return response.status;
}

export interface ProbeResult {
  /** True when the site answered the way a working tracked link does (a redirect). */
  ok: boolean;
  /** The site's answer code, or null when nothing answered at all. */
  status: number | null;
}

/**
 * One click to see whether the link is there, before thousands are sent.
 * It is a real click from this machine, so Dibs stores it like any other.
 */
export async function probeLink(baseUrl: string, code: string): Promise<ProbeResult> {
  try {
    const status = await click(linkUrl(baseUrl, code));
    return { ok: status >= 300 && status < 400, status };
  } catch {
    return { ok: false, status: null };
  }
}

export interface AttackReport {
  /** Requests started. */
  sent: number;
  /** Requests the site answered, with any answer code. */
  answered: number;
  /** Requests that got no answer (connection refused, dropped, timed out). */
  failed: number;
  seconds: number;
  /** How many answers of each code, for example { "302": 5000 }. */
  statuses: Record<string, number>;
}

/** Sends the clicks as fast as the site answers, keeping `atOnce` requests in the air. */
export async function sendClicks(input: { baseUrl: string; code: string; clicks: number; atOnce: number }): Promise<AttackReport> {
  const url = linkUrl(input.baseUrl, input.code);
  const report: AttackReport = { sent: 0, answered: 0, failed: 0, seconds: 0, statuses: {} };
  const started = performance.now();

  const worker = async () => {
    while (report.sent < input.clicks) {
      report.sent++;
      try {
        const status = await click(url);
        report.answered++;
        report.statuses[status] = (report.statuses[status] ?? 0) + 1;
      } catch {
        report.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(input.atOnce, input.clicks)) }, worker));

  report.seconds = (performance.now() - started) / 1000;
  return report;
}

export interface ClickCount {
  /** False when this database has no such link, which means it is not the site's database. */
  known: boolean;
  /** Every click stored for the link, cheats included. */
  stored: number;
  /** Clicks that count towards pay. */
  counted: number;
}

/**
 * Why the count could not be read, in words fit for the screen. The database's
 * own message for "the app has it open" tells the reader to stop the app,
 * which is the wrong advice in the middle of an attack.
 */
export function plainCountProblem(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("already open in another program")) {
    return "the site is running on this laptop with the built-in database, and only one program can have that open";
  }
  return message;
}

/**
 * The stand-in writes clicks straight into whatever database this command
 * reaches. That must never be the online one.
 */
export function standInProblem(kind: "embedded" | "hosted"): string | null {
  return kind === "hosted"
    ? "DATABASE_URL points at a hosted database, and the stand-in would fill it with pretend clicks. Empty the DATABASE_URL line in .env.local first, or attack the real site by leaving out --stand-in."
    : null;
}

/** Reads from the database how many clicks a link has, and how many of them count. */
export async function readClickCount(code: string): Promise<ClickCount> {
  const db = await getDb();
  const link = (await db.select({ code: trackedLinks.code }).from(trackedLinks).where(eq(trackedLinks.code, code)))[0];
  if (!link) return { known: false, stored: 0, counted: 0 };
  const row = (
    await db
      .select({
        stored: count(),
        counted: sql<number>`cast(count(*) filter (where ${clicks.counted}) as int)`,
      })
      .from(clicks)
      .where(eq(clicks.linkCode, code))
  )[0];
  return { known: true, stored: row.stored, counted: row.counted };
}
