/**
 * Lane B: checkers. Reading sources, cheat tests, AI and the tick live in
 * src/checkers and src/ai.
 * The names, inputs and outputs below are agreed in docs/CONTRACT.md.
 */
import type { CheckReport, JobCard, TickSummary } from "@/contract/types";
import { keepHandInFile } from "./files";
import { writeJobCardWithAi } from "./job-card";
import { runChecksAt } from "./run-checks";
import { endJobAt, tickAt } from "./tick";

/**
 * AI turns the poster's one sentence into a job card, including how the
 * result will be checked. Saves nothing: the screen shows the card, and
 * createJob stores it once the poster is happy. Throws a plain sentence when
 * the job cannot be posted as written (for example, no amount was given).
 */
export async function writeJobCard(input: {
  sentence: string;
  /** The poster's name, so the card can say "It must name Kettle & Clove". */
  posterName: string;
}): Promise<JobCard> {
  return writeJobCardWithAi(input);
}

/**
 * Runs the checks for one claim's result: reads the numbers from the source,
 * runs the cheat tests, works out what was earned, and saves the checks, a
 * reading and the result. Moves no money. Never lowers earnedCents, and never
 * turns a "paid" result back to "checking". docs/CONTRACT.md, section 3, has
 * the rules for status and for AI opinions.
 */
export async function runChecks(claimId: string): Promise<CheckReport> {
  return runChecksAt(claimId, new Date());
}

/**
 * The heartbeat, called every minute by an outside timer: runs every check
 * that is due, asks lane A to pay what is owed (no more often per job than
 * settings.payBatchMinutes), and for jobs past their end does one last check
 * and payment, then lets go of the hold.
 */
export async function tick(now: Date = new Date()): Promise<TickSummary> {
  return tickAt(now);
}

/**
 * The poster ends their own job before its end date. Closes it the way the
 * tick closes a job past its end: one last check and payment for each result,
 * then the rest of the hold is let go. Only the job's poster may call it.
 * "ended" is false when the closing could not finish at once; the tick then
 * finishes it, and "note" says so in plain words.
 */
export async function endJob(input: { jobId: string; posterId: string }): Promise<{ ended: boolean; note: string | null }> {
  return endJobAt(input, new Date());
}

/**
 * Keeps a file a worker uploaded (a recording, a translation) and returns
 * where it is kept, ready to pass to handIn as "file".
 */
export async function storeHandInFile(input: {
  claimId: string;
  fileName: string;
  bytes: Uint8Array;
}): Promise<string> {
  return keepHandInFile(input);
}
