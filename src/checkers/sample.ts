/**
 * The sample data (the six pretend jobs and their results that fill the
 * board) is a backdrop. Its links are made up and no PayPal hold stands
 * behind its jobs, so the tick must leave it alone: never re-read, never
 * written to, never paid, blocked or closed.
 *
 * A sample result is told apart by its id being one the sample data makes
 * AND its hand-in still being the made-up one. If a real person hands in
 * something of their own on a sample claim, it is theirs and is checked.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { results } from "@/db/schema";
import { buildSeed } from "@/db/seed-data";

type SampleResult = { id: string; handInUrl: string | null; handInFile: string | null; status: string; summary: string | null };

const holder = globalThis as unknown as { __dibsSample?: { results: Map<string, SampleResult>; jobs: Set<string> }; __dibsSampleGuardOff?: boolean };

function sample() {
  if (!holder.__dibsSample) {
    const rows = buildSeed(new Date());
    holder.__dibsSample = {
      results: new Map(
        rows.results.map((r) => [r.id, { id: r.id, handInUrl: r.handInUrl ?? null, handInFile: r.handInFile ?? null, status: r.status ?? "checking", summary: r.summary ?? null }]),
      ),
      jobs: new Set(rows.jobs.map((j) => j.id)),
    };
  }
  return holder.__dibsSample;
}

/** True for a result from the sample data whose hand-in is still the made-up one. */
export function isSampleResult(row: { id: string; handInUrl: string | null; handInFile: string | null }): boolean {
  if (holder.__dibsSampleGuardOff) return false;
  const made = sample().results.get(row.id);
  return made !== undefined && made.handInUrl === row.handInUrl && made.handInFile === row.handInFile;
}

/** True for a job from the sample data that still has its pretend PayPal hold. */
export function isSampleJob(job: { id: string; paypalAuthorizationId: string | null }): boolean {
  if (holder.__dibsSampleGuardOff) return false;
  return sample().jobs.has(job.id) && (job.paypalAuthorizationId ?? "").startsWith("SAMPLE-");
}

/**
 * For tests written before this rule, which use the sample rows as if they
 * were real work. Pass false to switch the rule off, true to switch it back on.
 */
export function guardSampleData(on: boolean): void {
  holder.__dibsSampleGuardOff = !on;
}

/** The sentence the tick wrote on sample cards before it learned to leave them alone. */
const WRONG_LINE = "This link is not a video we can read. Please hand in the link to a public YouTube video.";

/**
 * Puts back the sample cards the tick wrote that sentence on: their own
 * sentence and status return, and they are never due for a check again.
 * Touches only sample results that still have their made-up hand-in and
 * carry exactly that sentence. Safe to run any number of times. Returns how
 * many cards were put back.
 */
export async function restoreSampleCards(db: Db): Promise<number> {
  const made = sample().results;
  const marked = await db
    .select()
    .from(results)
    .where(and(inArray(results.id, [...made.keys()]), eq(results.summary, WRONG_LINE)));
  let restored = 0;
  for (const row of marked) {
    const original = made.get(row.id)!;
    if (original.handInUrl !== row.handInUrl || original.handInFile !== row.handInFile) continue; // a real hand-in: leave it
    await db
      .update(results)
      .set({ status: original.status as typeof row.status, summary: original.summary, nextCheckAt: null })
      .where(and(eq(results.id, row.id), eq(results.summary, WRONG_LINE)));
    restored++;
  }
  return restored;
}
