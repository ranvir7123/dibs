/**
 * The heartbeat. An outside timer calls it every minute through
 * src/app/api/tick. It runs every check that is due, asks lane A to pay what
 * is owed (in batches, not on every view), and closes jobs past their end.
 * One failure never stops the rest: it goes into "problems".
 */
import { and, eq, gt, inArray, isNull, lte, max, sql } from "drizzle-orm";
import type { TickSummary } from "@/contract/types";
import { getDb } from "@/db/client";
import { jobs, moneyMoves, results } from "@/db/schema";
import { letGo, payWorker } from "@/money";
import { settings } from "@/settings";
import { runChecksAt } from "./run-checks";

/** A tick stops starting new work after this long, so it ends before the web host cuts it off. The rest runs on the next tick. */
const TICK_BUDGET_MS = 240_000;

const holder = globalThis as unknown as { __dibsTickRunning?: boolean };
const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface Owed {
  resultId: string;
  jobId: string;
  /** Earned minus takes that are done or on their way. Zero for a blocked result: nothing more is paid after a block. */
  owedCents: number;
  /** Money was taken from the hold but has not reached the worker. Lane A sends that payout again. */
  payoutStuck: boolean;
}

/** What each result on the given jobs is still owed. */
async function owedByResult(jobIds: string[]): Promise<Owed[]> {
  if (jobIds.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select({
      resultId: results.id,
      jobId: results.jobId,
      status: results.status,
      earned: results.earnedCents,
      taken: sql<number>`coalesce(sum(${moneyMoves.amountCents}) filter (where ${moneyMoves.kind} = 'take' and ${moneyMoves.status} in ('done', 'pending')), 0)`.mapWith(Number),
      takesDone: sql<number>`count(*) filter (where ${moneyMoves.kind} = 'take' and ${moneyMoves.status} = 'done')`.mapWith(Number),
      payoutsDone: sql<number>`count(*) filter (where ${moneyMoves.kind} = 'payout' and ${moneyMoves.status} = 'done')`.mapWith(Number),
    })
    .from(results)
    .leftJoin(moneyMoves, eq(moneyMoves.resultId, results.id))
    .where(inArray(results.jobId, jobIds))
    .groupBy(results.id);
  return rows.map((r) => ({
    resultId: r.resultId,
    jobId: r.jobId,
    owedCents: r.status === "blocked" ? 0 : Math.max(0, r.earned - r.taken),
    payoutStuck: r.takesDone > r.payoutsDone,
  }));
}

export async function tickAt(now: Date = new Date()): Promise<TickSummary> {
  const summary: TickSummary = { ranAt: now, checksRun: 0, payoutsSent: 0, paidCents: 0, jobsEnded: 0, problems: [] };
  if (holder.__dibsTickRunning) {
    summary.problems.push("The last tick is still running, so this one did nothing.");
    return summary;
  }
  holder.__dibsTickRunning = true;
  const started = Date.now();
  const outOfTime = () => Date.now() - started > TICK_BUDGET_MS;

  const check = async (claimId: string, resultId: string): Promise<boolean> => {
    try {
      await runChecksAt(claimId, now);
      summary.checksRun++;
      return true;
    } catch (error) {
      summary.problems.push(`Check for result ${resultId}: ${said(error)}`);
      // Tried again at the usual pace, not every minute: a failing AI call must not be repeated 60 times an hour.
      const db = await getDb();
      await db
        .update(results)
        .set({ nextCheckAt: new Date(now.getTime() + settings.checkEveryMinutes * 60_000) })
        .where(and(eq(results.id, resultId), lte(results.nextCheckAt, now)))
        .catch(() => {});
      return false;
    }
  };
  const pay = async (resultId: string) => {
    try {
      const outcome = await payWorker(resultId);
      if (outcome.paidCents > 0) {
        summary.payoutsSent++;
        summary.paidCents += outcome.paidCents;
      }
    } catch (error) {
      summary.problems.push(`Payment for result ${resultId}: ${said(error)}`);
    }
  };

  try {
    const db = await getDb();

    // 1. Every check that is due, on jobs that are still running.
    const due = await db
      .select({ claimId: results.claimId, resultId: results.id })
      .from(results)
      .innerJoin(jobs, eq(jobs.id, results.jobId))
      .where(and(lte(results.nextCheckAt, now), isNull(results.objectedAt), eq(jobs.status, "open"), gt(jobs.endsAt, now)))
      .orderBy(results.nextCheckAt);
    for (const row of due) {
      if (outOfTime()) {
        summary.problems.push("Ran out of time; the remaining checks run on the next tick.");
        break;
      }
      await check(row.claimId, row.resultId);
    }

    // 2. Pay what is owed, one batch per job, no more often than the batch wait.
    const running = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.status, "open"), gt(jobs.endsAt, now)));
    const runningIds = running.map((j) => j.id);
    const lastTakes = runningIds.length
      ? await db
          .select({ jobId: moneyMoves.jobId, at: max(moneyMoves.createdAt) })
          .from(moneyMoves)
          .where(and(inArray(moneyMoves.jobId, runningIds), eq(moneyMoves.kind, "take")))
          .groupBy(moneyMoves.jobId)
      : [];
    const lastPaid = new Map(lastTakes.map((t) => [t.jobId, t.at]));
    const batchWaitMs = settings.payBatchMinutes * 60_000;
    for (const owed of await owedByResult(runningIds)) {
      if (owed.payoutStuck) {
        // The money already left the hold, so this is not a new batch: it is sent on at once.
        if (!outOfTime()) await pay(owed.resultId);
        continue;
      }
      if (owed.owedCents < settings.minPayoutCents) continue;
      const last = lastPaid.get(owed.jobId);
      // "last" is read once before paying, so everyone owed on a job is paid in the same batch.
      if (last && now.getTime() - last.getTime() < batchWaitMs) continue;
      if (outOfTime()) break;
      await pay(owed.resultId);
    }

    // 3. Jobs past their end: one last check and payment for each result, then the rest of the hold is let go.
    const over = await db.select().from(jobs).where(and(eq(jobs.status, "open"), lte(jobs.endsAt, now)));
    for (const job of over) {
      if (outOfTime()) break;
      const jobResults = await db.select().from(results).where(eq(results.jobId, job.id));
      let allChecked = true;
      for (const r of jobResults) {
        if (!r.objectedAt && r.status !== "blocked") allChecked = (await check(r.claimId, r.id)) && allChecked;
      }
      for (const owed of await owedByResult([job.id])) {
        if (owed.owedCents > 0 || owed.payoutStuck) await pay(owed.resultId);
      }
      // The hold is the only money there is. It is not let go while a worker is still owed, or a last check failed.
      const unpaid = (await owedByResult([job.id])).filter((o) => o.owedCents > 0 || o.payoutStuck);
      if (!allChecked || unpaid.length > 0) {
        summary.problems.push(
          `Job ${job.id} has ended but its hold is kept: ${unpaid.length ? `${unpaid.length} result(s) are still owed money` : "a last check did not finish"}. It is tried again on the next tick.`,
        );
        continue;
      }
      // An AI opinion the poster can still object to keeps the hold until its window closes.
      // A job (21 days at most) plus the window (3 days) still fits inside a PayPal hold (29 days).
      const stillOpen = (await db.select().from(results).where(eq(results.jobId, job.id))).some(
        (r) => r.status === "waiting" && !r.objectedAt && r.objectionEndsAt && r.objectionEndsAt.getTime() > now.getTime(),
      );
      if (stillOpen) continue;
      try {
        await letGo(job.id);
        summary.jobsEnded++;
      } catch (error) {
        summary.problems.push(`Letting go of the hold for job ${job.id}: ${said(error)}`);
      }
    }
  } catch (error) {
    summary.problems.push(`The tick stopped early: ${said(error)}`);
  } finally {
    holder.__dibsTickRunning = false;
  }
  return summary;
}
