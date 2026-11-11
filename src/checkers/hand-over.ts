/**
 * Handing slow checks to Render's background tasks ("Render Workflows").
 *
 * A check is slow when AI has to watch a video or a recording, or read a
 * file: it can take minutes. Online, the tick can hand each of those to its
 * own background task and move on, so one long video never holds up the
 * other checks or the payments. The task does the very same work
 * (runChecksAt) and saves the result itself.
 *
 * The switch: all three of these must be set, or the tick simply does the
 * work itself, as it does on a laptop.
 *   DIBS_CHECKS_ON_RENDER = 1
 *   RENDER_API_KEY         a key from Render, so the tick may start tasks
 *   DIBS_CHECKS_WORKFLOW   the name Render gave the task service (render.yaml fills it in)
 */
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { checks, jobs, results } from "@/db/schema";
import { settings } from "@/settings";
import { runChecksAt } from "./run-checks";

/** The task's name on Render. scripts/tick-worker.ts registers it under this name. */
export const CHECK_TASK = "runCheck";

/** How long asking Render to start a task may take before the tick does the check itself. */
const START_TASK_MS = 20_000;

const set = (name: string) => process.env[name]?.trim() || "";

/** True when slow checks are to be handed to Render's background tasks. */
export function handOverOn(): boolean {
  return set("DIBS_CHECKS_ON_RENDER") === "1" && set("RENDER_API_KEY") !== "" && set("DIBS_CHECKS_WORKFLOW") !== "";
}

/**
 * True when the next check of this claim will make AI watch or read
 * something: the job uses AI, and AI has not yet answered for what is
 * handed in now. Later re-reads of the same hand-in (view counts, clicks)
 * reuse AI's answer and are quick.
 */
export async function nextCheckIsSlow(claimId: string): Promise<boolean> {
  const db = await getDb();
  const result = (await db.select().from(results).where(eq(results.claimId, claimId)))[0];
  if (!result || result.handInKind === "none") return false;
  const job = (await db.select().from(jobs).where(eq(jobs.id, result.jobId)))[0];
  const { checker } = job.card;
  const usesAi = !checker.machineCheckable || checker.evidence.some((e) => e === "ai_watch" || e === "ai_read" || e === "ai_opinion" || e === "live_site");
  if (!usesAi) return false;
  // A posted video with nothing it must show is only counted, never watched.
  if (checker.machineCheckable && result.handInKind === "link" && checker.mustShow.length === 0) return false;

  const answered = await db
    .select({ key: checks.key, group: checks.group })
    .from(checks)
    .where(and(eq(checks.resultId, result.id), gte(checks.ranAt, result.handedInAt)));
  return !answered.some((c) => c.group === "must_show" || c.group === "rule" || c.group === "opinion" || c.key === "recording");
}

/** Starts one background task and returns Render's number for the run. */
export type TaskStarter = (task: string, claimId: string) => Promise<string>;

const renderStarter: TaskStarter = async (task, claimId) => {
  // Loaded only when the switch is on, so a laptop never needs Render's kit.
  const { Render } = await import("@renderinc/sdk");
  try {
    const render = new Render();
    const run = await render.workflows.startTask(task as `${string}/${string}`, [claimId], AbortSignal.timeout(START_TASK_MS));
    return run.taskRunId;
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    if (/unauthori[sz]ed|forbidden|\b401\b|\b403\b/i.test(said)) throw new Error("Render refused the key in RENDER_API_KEY");
    if (/not found|\b404\b/i.test(said)) throw new Error(`Render has no task called ${task}`);
    if (/abort|timed? ?out/i.test(said)) throw new Error("Render did not answer in time");
    throw new Error(`Render said: ${said.replace(/\s*undefined\s*$/, "")}`);
  }
};

const holder = globalThis as unknown as { __dibsTaskStarter?: TaskStarter | null };
/** Swaps the task starter for a stand-in (tests). Pass null to go back to Render's. */
export function useTaskStarter(starter: TaskStarter | null): void {
  holder.__dibsTaskStarter = starter;
}

/**
 * Hands one claim's check to a background task. The result's next check time
 * is pushed on first, so the tick does not hand the same check over again a
 * minute later while the task is still watching. Returns Render's run number.
 * Throws when Render could not start the task; the caller then does the check itself.
 */
export async function handOverCheck(claimId: string, resultId: string, now: Date): Promise<string> {
  const db = await getDb();
  const before = (await db.select({ nextCheckAt: results.nextCheckAt }).from(results).where(eq(results.id, resultId)))[0];
  await db
    .update(results)
    .set({ nextCheckAt: new Date(now.getTime() + settings.checkEveryMinutes * 60_000) })
    .where(eq(results.id, resultId));
  try {
    const start = holder.__dibsTaskStarter ?? renderStarter;
    return await start(`${set("DIBS_CHECKS_WORKFLOW")}/${CHECK_TASK}`, claimId);
  } catch (error) {
    // Not handed over after all: put the check time back so the work is not lost for ten minutes.
    await db.update(results).set({ nextCheckAt: before?.nextCheckAt ?? now }).where(eq(results.id, resultId));
    throw error;
  }
}

/**
 * What the background task does: the same check the tick would have done.
 * Returns a small, plain summary for Render's own page. Moves no money; the
 * next tick pays what the check found was earned.
 */
export async function runHandedOverCheck(claimId: string): Promise<{ claimId: string; status: string; earnedCents: number; summary: string }> {
  const report = await runChecksAt(claimId, new Date());
  return { claimId, status: report.status, earnedCents: report.earnedCents, summary: report.summary };
}
